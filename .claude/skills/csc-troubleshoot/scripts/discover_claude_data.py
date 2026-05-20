#!/usr/bin/env python3
"""Discover Claude Code data sources under ~/.claude/.

Handles project-directory mapping, session discovery, time-range filtering,
and enumeration of telemetry, plugins, debug, and other diagnostic directories.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional


CLAUDE_DIR = Path.home() / ".claude"


def _path_to_project_dir(path: str) -> str:
    """Map a filesystem path to Claude's project directory name.

    /Users/demo/prompts  →  -Users-demo-prompts
    C:\\Users\\demo\\app  →  -C-Users-demo-app
    """
    abs_path = str(Path(path).resolve())
    # Replace path separators with hyphens, then prepend a hyphen
    parts = abs_path.replace("\\", "/").strip("/").split("/")
    return "-" + "-".join(parts)


def _parse_time_arg(value: str) -> int:
    """Parse a time argument into epoch milliseconds.

    Supports:
      - ISO 8601: 2026-05-13T12:00:00+08:00
      - YYYY-MM-DD HH:MM (local time)
      - Relative: 24h ago, 2d ago, 30m ago
    """
    now = datetime.now()

    # Relative
    m = re.match(r"(\d+)\s*(h|d|m|hour|day|min|hr|minute)s?\s+ago", value, re.IGNORECASE)
    if m:
        num = int(m.group(1))
        unit = m.group(2).lower()[0]
        if unit == "h":
            dt = now - timedelta(hours=num)
        elif unit == "d":
            dt = now - timedelta(days=num)
        elif unit == "m":
            dt = now - timedelta(minutes=num)
        else:
            dt = now - timedelta(hours=24)
        return int(dt.timestamp() * 1000)

    # YYYY-MM-DD HH:MM
    m = re.match(r"(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})", value)
    if m:
        try:
            dt = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%m-%d %H:%M")
            return int(dt.timestamp() * 1000)
        except ValueError:
            pass

    # ISO 8601
    try:
        dt = datetime.fromisoformat(value)
        return int(dt.timestamp() * 1000)
    except ValueError:
        pass

    # Plain date
    try:
        dt = datetime.strptime(value, "%Y-%m-%d")
        return int(dt.timestamp() * 1000)
    except ValueError:
        pass

    return 0


def discover_project_dir(project_path: str) -> Optional[Path]:
    """Discover the Claude project directory for a given workspace path."""
    proj_name = _path_to_project_dir(project_path)
    proj_dir = CLAUDE_DIR / "projects" / proj_name
    if proj_dir.exists():
        return proj_dir
    return None


def discover_sessions(project_dir: Path,
                      time_from_ms: int = 0,
                      time_to_ms: int = 0) -> list[dict]:
    """Discover sessions within a project directory, filtered by time range."""
    sessions = []
    if not project_dir or not project_dir.exists():
        return sessions

    now_ms = int(datetime.now().timestamp() * 1000)
    if time_to_ms <= 0:
        time_to_ms = now_ms

    for entry in project_dir.iterdir():
        if entry.suffix == ".jsonl":
            uuid = entry.stem
            mtime_ms = int(entry.stat().st_mtime * 1000)
            size = entry.stat().st_size

            if time_from_ms > 0 and mtime_ms < time_from_ms:
                continue
            if mtime_ms > time_to_ms:
                continue

            # Check for subagent directory
            subagent_dir = project_dir / uuid
            has_subagents = subagent_dir.is_dir()
            subagent_count = 0
            if has_subagents:
                sa_dir = subagent_dir / "subagents"
                if sa_dir.exists():
                    subagent_count = len(list(sa_dir.glob("*.jsonl")))

            sessions.append({
                "session_id": uuid,
                "mtime_ms": mtime_ms,
                "mtime_iso": datetime.fromtimestamp(mtime_ms / 1000).isoformat(),
                "size_bytes": size,
                "has_subagents": has_subagents,
                "subagent_count": subagent_count,
            })

    sessions.sort(key=lambda s: s["mtime_ms"], reverse=True)
    return sessions


def find_current_session(project_dir: Path) -> Optional[str]:
    """Find the most likely current session UUID.

    Strategy:
    1. Check sessions/*.json for a session with matching cwd and recent updatedAt.
    2. Fall back to most recently modified JSONL in the project directory.
    """
    if project_dir and project_dir.exists():
        sessions = discover_sessions(project_dir)
        if sessions:
            return sessions[0]["session_id"]

    # Fall back to sessions/ directory
    sessions_dir = CLAUDE_DIR / "sessions"
    if sessions_dir.exists():
        entries = []
        for f in sessions_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text())
                entries.append(data)
            except (json.JSONDecodeError, OSError):
                continue
        entries.sort(key=lambda e: e.get("updatedAt", 0), reverse=True)
        if entries:
            return entries[0].get("sessionId")

    return None


def discover_telemetry(time_from_ms: int = 0,
                       time_to_ms: int = 0,
                       session_id: str = "") -> list[dict]:
    """Discover telemetry failed events, optionally filtered."""
    tele_dir = CLAUDE_DIR / "telemetry"
    if not tele_dir.exists():
        return []

    now_ms = int(datetime.now().timestamp() * 1000)
    if time_to_ms <= 0:
        time_to_ms = now_ms

    events = []
    for f in tele_dir.iterdir():
        if not f.name.startswith("1p_failed_events."):
            continue
        mtime_ms = int(f.stat().st_mtime * 1000)

        if time_from_ms > 0 and mtime_ms < time_from_ms:
            continue
        if mtime_ms > time_to_ms:
            continue

        # Session filter: filename format is 1p_failed_events.<session-uuid>.<event-uuid>.json
        parts = f.stem.split(".")
        file_session_id = parts[1] if len(parts) >= 2 else ""
        if session_id and file_session_id and file_session_id != session_id:
            continue

        events.append({
            "file": f.name,
            "session_id": file_session_id,
            "size_bytes": f.stat().st_size,
            "mtime_ms": mtime_ms,
            "mtime_iso": datetime.fromtimestamp(mtime_ms / 1000).isoformat(),
        })

    events.sort(key=lambda e: e["mtime_ms"], reverse=True)
    return events


def discover_plugins() -> list[dict]:
    """Discover installed Claude Code plugins."""
    plugins_dir = CLAUDE_DIR / "plugins"
    if not plugins_dir.exists():
        return []

    plugins = []
    for entry in plugins_dir.iterdir():
        if entry.is_dir():
            manifest = entry / "manifest.json"
            manifest_data = {}
            if manifest.exists():
                try:
                    manifest_data = json.loads(manifest.read_text())
                except (json.JSONDecodeError, OSError):
                    pass
            plugins.append({
                "name": entry.name,
                "mtime_ms": int(entry.stat().st_mtime * 1000),
                "manifest": manifest_data,
            })
        elif entry.is_symlink():
            plugins.append({
                "name": entry.name,
                "symlink_target": str(entry.resolve()),
                "mtime_ms": int(entry.stat().st_mtime * 1000),
                "manifest": {},
            })

    plugins.sort(key=lambda p: p["name"])
    return plugins


def discover_debug_files() -> list[dict]:
    """List files in debug directory."""
    debug_dir = CLAUDE_DIR / "debug"
    if not debug_dir.exists():
        return []

    files = []
    for f in debug_dir.iterdir():
        if f.is_file():
            files.append({
                "name": f.name,
                "size_bytes": f.stat().st_size,
                "mtime_ms": int(f.stat().st_mtime * 1000),
                "mtime_iso": datetime.fromtimestamp(
                    f.stat().st_mtime
                ).isoformat(),
            })

    files.sort(key=lambda f: f["mtime_ms"], reverse=True)
    return files


def discover_all_projects() -> list[dict]:
    """List all known Claude Code project directories."""
    projects_dir = CLAUDE_DIR / "projects"
    if not projects_dir.exists():
        return []

    projects = []
    for entry in sorted(projects_dir.iterdir()):
        if entry.is_dir() and entry.name.startswith("-"):
            jsonl_count = len(list(entry.glob("*.jsonl")))
            projects.append({
                "claude_name": entry.name,
                "jsonl_count": jsonl_count,
                "mtime_ms": int(entry.stat().st_mtime * 1000),
                "mtime_iso": datetime.fromtimestamp(
                    entry.stat().st_mtime
                ).isoformat(),
            })

    projects.sort(key=lambda p: p["mtime_ms"], reverse=True)
    return projects


def discover_perf_reports(time_from_ms: int = 0,
                          time_to_ms: int = 0) -> list[dict]:
    """List performance reports within time range."""
    perf_dir = CLAUDE_DIR / "perf-reports"
    if not perf_dir.exists():
        return []

    now_ms = int(datetime.now().timestamp() * 1000)
    if time_to_ms <= 0:
        time_to_ms = now_ms

    reports = []
    seen = set()
    for f in sorted(perf_dir.iterdir()):
        mtime_ms = int(f.stat().st_mtime * 1000)
        if time_from_ms > 0 and mtime_ms < time_from_ms:
            continue
        if mtime_ms > time_to_ms:
            continue

        stem = f.stem
        # Deduplicate: perf-<timestamp>-<name>.{json,md,csv} → group by base name
        base = re.sub(r"\.(json|md|csv)$", "", stem)
        if base in seen:
            continue
        seen.add(base)

        reports.append({
            "base": base,
            "mtime_ms": mtime_ms,
            "mtime_iso": datetime.fromtimestamp(mtime_ms / 1000).isoformat(),
        })

    reports.sort(key=lambda r: r["mtime_ms"], reverse=True)
    return reports


def discover_sessions_index() -> list[dict]:
    """Read all session metadata from sessions/*.json."""
    sessions_dir = CLAUDE_DIR / "sessions"
    if not sessions_dir.exists():
        return []

    index = []
    for f in sessions_dir.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            # Strip large fields
            index.append({
                "pid": data.get("pid"),
                "sessionId": data.get("sessionId"),
                "cwd": data.get("cwd"),
                "startedAt": data.get("startedAt"),
                "updatedAt": data.get("updatedAt"),
                "version": data.get("version"),
                "status": data.get("status"),
                "name": data.get("name"),
                "kind": data.get("kind"),
            })
        except (json.JSONDecodeError, OSError):
            continue

    index.sort(key=lambda s: s.get("updatedAt", 0), reverse=True)
    return index


# ── CLI ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Discover Claude Code data sources"
    )
    parser.add_argument("--project", help="Project path (default: current directory)")
    parser.add_argument("--session", help="Specific session UUID")
    parser.add_argument("--time-from", help="Start time filter")
    parser.add_argument("--time-to", help="End time filter")
    parser.add_argument("--all-projects", action="store_true")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    time_from_ms = _parse_time_arg(args.time_from) if args.time_from else 0
    time_to_ms = _parse_time_arg(args.time_to) if args.time_to else 0
    if time_from_ms == 0 and not args.time_from:
        # Default: 24 hours ago
        time_from_ms = int(
            (datetime.now() - timedelta(hours=24)).timestamp() * 1000
        )

    project_path = args.project or os.getcwd()
    project_dir = discover_project_dir(project_path)

    session_id = args.session
    if not session_id:
        session_id = find_current_session(project_dir)

    result = {
        "claude_dir": str(CLAUDE_DIR),
        "claude_dir_exists": CLAUDE_DIR.exists(),
        "project_path": project_path,
        "project_claude_name": _path_to_project_dir(project_path),
        "project_dir_exists": project_dir is not None,
        "current_session_id": session_id,
        "time_from_ms": time_from_ms,
        "time_to_ms": time_to_ms if time_to_ms else int(datetime.now().timestamp() * 1000),
        "sessions": discover_sessions(project_dir, time_from_ms, time_to_ms) if project_dir else [],
        "sessions_index": discover_sessions_index(),
        "telemetry_events": discover_telemetry(time_from_ms, time_to_ms, session_id),
        "plugins": discover_plugins(),
        "debug_files": discover_debug_files(),
        "perf_reports": discover_perf_reports(time_from_ms, time_to_ms),
        "all_projects": discover_all_projects() if args.all_projects else [],
    }

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
