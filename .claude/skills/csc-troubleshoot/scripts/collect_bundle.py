#!/usr/bin/env python3
"""Main entry point for Claude Code troubleshooting bundle collection.

Orchestrates discovery, collection, sanitization, and packaging of diagnostic
data from ~/.claude/ into a structured debug bundle.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

# ── path helpers ────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent


def _script(name: str) -> Path:
    return SCRIPT_DIR / name


# ── symptom routing ─────────────────────────────────────────────────

SYMPTOM_ROUTING = {
    "hang": {
        "keywords": ["卡住", "无响应", "hang", "stuck", "不动", "没反应", "freeze"],
        "description": "任务/会话无响应",
        "default_rounds": 10,
        "include_tasks": True,
        "focus": "tasks state + session transcript (last 10 rounds) + session metadata",
        "extra_includes": [],
    },
    "hook_failure": {
        "keywords": ["hook", "钩子", "stopfailure", "stop failure", "pretooluse", "posttooluse"],
        "description": "Hook 执行失败",
        "default_rounds": 30,
        "time_window_multiplier": 2.0,
        "include_shell_snapshot": True,
        "focus": "hooks config + shell snapshot + session transcript + debug logs",
        "extra_includes": ["--include-debug"],
    },
    "permission": {
        "keywords": ["权限", "permission", "sandbox", "沙盒", "denied", "拒绝", "不允许"],
        "description": "权限/沙盒异常",
        "default_rounds": 20,
        "focus": "permissions config + sandbox config + session transcript",
        "extra_includes": [],
    },
    "api_error": {
        "keywords": ["api", "模型", "model", "rate limit", "超时", "token", "调用失败",
                      "timeout", "401", "403", "429", "500", "502", "503"],
        "description": "模型 API 调用错误",
        "default_rounds": 15,
        "focus": "telemetry + env/model config + gateway cache + session transcript + debug logs",
        "extra_includes": ["--include-debug"],
    },
    "session_lost": {
        "keywords": ["会话", "session", "历史", "history", "不见了", "丢失", "gone", "lost"],
        "description": "会话/历史丢失",
        "include_all_sessions": True,
        "default_rounds": 30,
        "time_window_multiplier": 7.0,
        "focus": "sessions index + all project JSONL listings + history",
        "extra_includes": ["--include-history"],
    },
    "startup_crash": {
        "keywords": ["启动", "打不开", "crash", "闪退", "startup", "无法启动", "launch"],
        "description": "启动失败/闪退",
        "default_rounds": 5,
        "time_window_multiplier": 2.0,
        "focus": "settings + debug + cache + shell snapshots + plugins",
        "extra_includes": ["--include-debug"],
    },
    "plugin": {
        "keywords": ["插件", "plugin", "mcp", "extension"],
        "description": "插件/MCP 问题",
        "focus": "plugins dir + settings MCP/plugin config + telemetry + debug logs",
        "extra_includes": ["--include-debug"],
    },
    "tool_error": {
        "keywords": ["tool", "工具", "bash", "command", "execute", "执行失败"],
        "description": "工具调用失败",
        "default_rounds": 25,
        "focus": "session transcript (focus ToolUse errors) + telemetry + debug logs",
        "extra_includes": ["--include-debug"],
    },
}


def identify_symptom(user_input: str) -> Optional[str]:
    """Identify symptom type from user input. Returns symptom key or None."""
    if not user_input:
        return None
    lower = user_input.lower()
    for key, config in SYMPTOM_ROUTING.items():
        for kw in config["keywords"]:
            if kw in lower:
                return key
    return None


def apply_symptom_routing(symptom: str, params: dict) -> dict:
    """Adjust collection parameters based on symptom type."""
    config = SYMPTOM_ROUTING.get(symptom)
    if not config:
        return params

    # Only adjust if user didn't explicitly set them
    if "rounds" not in params and "default_rounds" in config:
        params["rounds"] = config["default_rounds"]

    if "time_window_multiplier" in config:
        params["time_window_multiplier"] = config["time_window_multiplier"]

    for extra in config.get("extra_includes", []):
        flag = extra.replace("--", "").replace("-", "_")
        if flag not in params:
            params[flag] = True

    return params


# ── time parsing ────────────────────────────────────────────────────

def parse_time(value: str) -> int:
    """Parse a time string to epoch ms. Returns 0 on failure."""
    if not value:
        return 0
    now = datetime.now()

    # Relative
    m = re.match(r"(\d+)\s*(h|d|m|hr|min)s?\s+ago", value, re.IGNORECASE)
    if m:
        num = int(m.group(1))
        unit = m.group(2)[0].lower()
        delta = {"h": timedelta(hours=num), "d": timedelta(days=num),
                  "m": timedelta(minutes=num)}.get(unit)
        if delta:
            return int((now - delta).timestamp() * 1000)

    # YYYY-MM-DD HH:MM
    m = re.match(r"(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})", value)
    if m:
        try:
            dt = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%m-%d %H:%M")
            return int(dt.timestamp() * 1000)
        except ValueError:
            pass

    # ISO
    try:
        return int(datetime.fromisoformat(value).timestamp() * 1000)
    except (ValueError, TypeError):
        pass

    # Plain date
    try:
        return int(datetime.strptime(value, "%Y-%m-%d").timestamp() * 1000)
    except ValueError:
        pass

    return 0


# ── file helpers ────────────────────────────────────────────────────

def hash_file(path: Path) -> str:
    """SHA-256 hex digest of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def copy_file_safe(src: Path, dst: Path) -> Optional[str]:
    """Copy a file, return warning string or None."""
    if not src.exists():
        return f"source missing: {src}"
    try:
        ensure_dir(dst.parent)
        shutil.copy2(src, dst)
    except OSError as e:
        return f"copy failed: {e}"
    return None


# ── JSONL helpers ───────────────────────────────────────────────────

def _normalize_timestamp(ts: Any) -> int:
    """Normalize a timestamp value to epoch milliseconds."""
    if ts is None:
        return 0
    if isinstance(ts, (int, float)):
        return int(ts)
    if isinstance(ts, str):
        try:
            return int(ts)
        except ValueError:
            pass
        try:
            return int(datetime.fromisoformat(ts).timestamp() * 1000)
        except (ValueError, TypeError):
            pass
    return 0


def filter_jsonl_by_rounds(jsonl_path: Path, rounds: int,
                           time_from_ms: int = 0,
                           time_to_ms: int = 0,
                           apply_time_filter: bool = True) -> list[dict]:
    """Extract the last N user-assistant round pairs from a JSONL file,
    plus any surrounding system/error entries. Respects time window
    unless apply_time_filter is False (e.g. when session was explicitly targeted).
    """
    if not jsonl_path.exists():
        return []

    entries = []
    with open(jsonl_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if apply_time_filter:
                    ts = _normalize_timestamp(entry.get("timestamp"))
                    if time_from_ms and ts < time_from_ms:
                        continue
                    if time_to_ms and ts > time_to_ms:
                        continue
                entries.append(entry)
            except json.JSONDecodeError:
                continue

    if rounds and len(entries) > rounds * 2:
        # Find last N user entries and include context around them
        user_indices = [
            i for i, e in enumerate(entries)
            if e.get("type") == "user"
        ]
        if user_indices:
            start = max(0, user_indices[-rounds] - 2)
            entries = entries[start:]

    return entries


def extract_timeline_events(entries: list[dict]) -> list[dict]:
    """Extract key events from transcript entries for timeline generation."""
    events = []
    for e in entries:
        ts = _normalize_timestamp(e.get("timestamp"))
        t = e.get("type", "")
        event = {"timestamp": ts, "type": t}

        if t == "user":
            msg = e.get("message", {})
            content = msg.get("content", "")
            if isinstance(content, list):
                texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
                content = " ".join(texts)
            event["summary"] = str(content)[:200]
        elif t == "assistant":
            msg = e.get("message", {})
            content = msg.get("content", [])
            tool_uses = [c for c in content if isinstance(c, dict) and c.get("type") == "tool_use"]
            if tool_uses:
                event["tool_uses"] = [tu.get("name", "?") for tu in tool_uses]
            text = " ".join(
                c.get("text", "") for c in content
                if isinstance(c, dict) and c.get("type") == "text"
            )
            event["summary"] = text[:200]
        elif t == "system":
            event["summary"] = str(e.get("subtype", ""))
        elif t == "error":
            event["summary"] = str(e.get("message", ""))[:200]

        events.append(event)
    return events


# ── collection functions ────────────────────────────────────────────

def collect_settings(output_dir: Path) -> dict:
    """Collect and sanitize settings files."""
    result = {"collected": [], "missing": [], "warnings": []}
    claude_dir = Path.home() / ".claude"

    for name in ["settings.json", "settings.local.json"]:
        src = claude_dir / name
        dst = output_dir / "config" / f"{Path(name).stem}-sanitized.json"
        if src.exists():
            try:
                raw = src.read_text(encoding="utf-8", errors="replace")
                # Sanitize using in-process sanitize module
                from sanitize import sanitize_json
                out = sanitize_json(raw)
                ensure_dir(dst.parent)
                dst.write_text(out, encoding="utf-8")
                result["collected"].append({
                    "name": f"{name}-sanitized",
                    "path": str(dst.relative_to(output_dir)),
                    "bytes": len(out.encode("utf-8")),
                    "sha256": hashlib.sha256(out.encode()).hexdigest(),
                })
            except Exception as exc:
                result["warnings"].append(f"Failed to sanitize {name}: {exc}")
        else:
            result["missing"].append(name)

    return result


def collect_session_transcript(project_dir: Path, output_dir: Path,
                               session_id: str, rounds: int,
                               time_from_ms: int, time_to_ms: int,
                               apply_time_filter: bool = True) -> dict:
    """Collect and sanitize session transcript."""
    result = {"collected": [], "missing": [], "warnings": []}

    jsonl = project_dir / f"{session_id}.jsonl"
    if not jsonl.exists():
        result["missing"].append(str(jsonl))
        return result

    entries = filter_jsonl_by_rounds(jsonl, rounds, time_from_ms, time_to_ms, apply_time_filter)
    if not entries:
        result["warnings"].append("No entries matched time/rounds filter")
        return result

    # Write sanitized JSONL
    from sanitize import sanitize_jsonl, sanitize_text
    raw = "\n".join(json.dumps(e, ensure_ascii=False) for e in entries)
    sanitized = sanitize_jsonl(raw)
    dst = output_dir / "session" / "transcript-sanitized.jsonl"
    ensure_dir(dst.parent)
    dst.write_text(sanitized, encoding="utf-8")
    result["collected"].append({
        "name": "transcript-sanitized.jsonl",
        "path": str(dst.relative_to(output_dir)),
        "entry_count": len(entries),
        "bytes": len(sanitized.encode("utf-8")),
    })

    # Generate timeline
    events = extract_timeline_events(entries)
    timeline_md = "# Session Timeline\n\n"
    for ev in events:
        ts_str = datetime.fromtimestamp(ev["timestamp"] / 1000).strftime("%Y-%m-%d %H:%M:%S")
        t = ev["type"]
        summary = ev.get("summary", "")
        if t == "user":
            timeline_md += f"**{ts_str}** [USER] {summary}\n\n"
        elif t == "assistant":
            tools = ev.get("tool_uses", [])
            tool_str = f" (tools: {', '.join(tools)})" if tools else ""
            timeline_md += f"**{ts_str}** [ASSISTANT]{tool_str}\n\n"
        elif t == "error":
            timeline_md += f"**{ts_str}** [ERROR] {summary}\n\n"
        else:
            timeline_md += f"**{ts_str}** [{t.upper()}] {summary}\n\n"

    # Sanitize the timeline markdown
    timeline_md = sanitize_text(timeline_md)
    timeline_path = output_dir / "summary" / "timeline.md"
    ensure_dir(timeline_path.parent)
    timeline_path.write_text(timeline_md, encoding="utf-8")

    # Collect subagents if present
    subagent_dir = project_dir / session_id / "subagents"
    if subagent_dir.exists():
        sub_lines = []
        for sa in sorted(subagent_dir.glob("agent-*.jsonl")):
            raw_sa = sa.read_text(encoding="utf-8", errors="replace")
            sub_lines.append(raw_sa)
        if sub_lines:
            combined = "\n".join(sub_lines)
            sanitized_sa = sanitize_jsonl(combined)
            sa_dst = output_dir / "session" / "subagents-sanitized.jsonl"
            sa_dst.write_text(sanitized_sa, encoding="utf-8")
            result["collected"].append({
                "name": "subagents-sanitized.jsonl",
                "path": str(sa_dst.relative_to(output_dir)),
                "bytes": len(sanitized_sa.encode("utf-8")),
            })

    return result


def collect_telemetry(output_dir: Path, time_from_ms: int,
                      time_to_ms: int, session_id: str) -> dict:
    """Collect telemetry failure events."""
    result = {"collected": [], "missing": [], "warnings": []}

    tele_dir = Path.home() / ".claude" / "telemetry"
    if not tele_dir.exists():
        result["missing"].append("telemetry/")
        return result

    events = []
    for f in tele_dir.glob("1p_failed_events.*.json"):
        mtime_ms = int(f.stat().st_mtime * 1000)
        if time_from_ms and mtime_ms < time_from_ms:
            continue
        if time_to_ms and mtime_ms > time_to_ms:
            continue
        parts = f.stem.split(".")
        if len(parts) >= 2 and session_id and parts[1] != session_id:
            continue
        try:
            evt = json.loads(f.read_text(encoding="utf-8", errors="replace"))
            events.append(evt)
        except (json.JSONDecodeError, OSError):
            continue

    if events:
        from sanitize import sanitize_value
        sanitized = sanitize_value(events)
        raw_out = "\n".join(json.dumps(e, ensure_ascii=False) for e in sanitized)
        dst = output_dir / "errors" / "telemetry-failures-sanitized.jsonl"
        ensure_dir(dst.parent)
        dst.write_text(raw_out, encoding="utf-8")
        result["collected"].append({
            "name": "telemetry-failures-sanitized.jsonl",
            "path": str(dst.relative_to(output_dir)),
            "event_count": len(events),
            "bytes": len(raw_out.encode("utf-8")),
        })

    return result


def collect_plugins(output_dir: Path) -> dict:
    """Collect plugin inventory."""
    result = {"collected": [], "missing": [], "warnings": []}

    plugins_dir = Path.home() / ".claude" / "plugins"
    if not plugins_dir.exists():
        result["missing"].append("plugins/")
        return result

    plugins = []
    for entry in plugins_dir.iterdir():
        if entry.is_dir():
            manifest = entry / "manifest.json"
            mdata = {}
            if manifest.exists():
                try:
                    mdata = json.loads(manifest.read_text())
                except (json.JSONDecodeError, OSError):
                    pass
            plugins.append({
                "name": entry.name,
                "manifest": mdata,
                "is_symlink": entry.is_symlink(),
                "symlink_target": str(entry.resolve()) if entry.is_symlink() else None,
            })
        elif entry.is_symlink():
            plugins.append({
                "name": entry.name,
                "symlink_target": str(entry.resolve()),
                "is_symlink": True,
            })

    dst = output_dir / "plugins" / "plugins-list.json"
    ensure_dir(dst.parent)
    dst.write_text(json.dumps(plugins, indent=2, ensure_ascii=False), encoding="utf-8")
    result["collected"].append({
        "name": "plugins-list.json",
        "path": str(dst.relative_to(output_dir)),
        "plugin_count": len(plugins),
    })

    return result


def collect_hook_summary(output_dir: Path) -> dict:
    """Extract hook configuration from settings.json."""
    result = {"collected": [], "missing": [], "warnings": []}

    settings_path = Path.home() / ".claude" / "settings.json"
    if not settings_path.exists():
        result["missing"].append("settings.json")
        return result

    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError) as exc:
        result["warnings"].append(f"Failed to read settings.json: {exc}")
        return result

    hooks = settings.get("hooks", {})
    hook_summary = {}
    for hook_name, hook_config in hooks.items():
        if isinstance(hook_config, list):
            hook_summary[hook_name] = []
            for hc in hook_config:
                entry = {}
                if isinstance(hc, dict):
                    for k in ("matcher", "hooks", "type", "command"):
                        if k in hc:
                            val = hc[k]
                            # Redact any shell commands that contain sensitive data
                            if k == "command" and isinstance(val, str):
                                from sanitize import sanitize_text
                                val = sanitize_text(val)
                            entry[k] = val
                hook_summary[hook_name].append(entry)
        elif isinstance(hook_config, dict):
            hook_summary[hook_name] = dict(hook_config)

    from sanitize import sanitize_value
    hook_summary = sanitize_value(hook_summary)

    dst = output_dir / "hooks" / "hook-summary.json"
    ensure_dir(dst.parent)
    dst.write_text(json.dumps(hook_summary, indent=2, ensure_ascii=False), encoding="utf-8")
    result["collected"].append({
        "name": "hook-summary.json",
        "path": str(dst.relative_to(output_dir)),
    })

    return result


def collect_shell_snapshot(output_dir: Path, time_from_ms: int,
                           time_to_ms: int) -> dict:
    """Collect most recent shell snapshot."""
    result = {"collected": [], "missing": [], "warnings": []}
    snap_dir = Path.home() / ".claude" / "shell-snapshots"
    if not snap_dir.exists():
        result["missing"].append("shell-snapshots/")
        return result

    snapshots = sorted(snap_dir.glob("snapshot-*.sh"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not snapshots:
        return result

    snap = snapshots[0]
    raw = snap.read_text(encoding="utf-8", errors="replace")

    from sanitize import sanitize_text
    sanitized = sanitize_text(raw)

    dst = output_dir / "env" / "shell-snapshot-sanitized.txt"
    ensure_dir(dst.parent)
    dst.write_text(sanitized, encoding="utf-8")
    result["collected"].append({
        "name": "shell-snapshot-sanitized.txt",
        "path": str(dst.relative_to(output_dir)),
        "bytes": len(sanitized.encode("utf-8")),
    })

    return result


def collect_debug_index(output_dir: Path, include_debug: bool) -> dict:
    """Collect debug files index (and optionally sanitized content to errors/debug/)."""
    result = {"collected": [], "missing": [], "warnings": []}
    debug_dir = Path.home() / ".claude" / "debug"
    if not debug_dir.exists():
        result["missing"].append("debug/")
        return result

    files = []
    for f in debug_dir.iterdir():
        if f.is_file():
            info = {
                "name": f.name,
                "size_bytes": f.stat().st_size,
                "mtime": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
            }
            if include_debug:
                try:
                    raw = f.read_text(encoding="utf-8", errors="replace")
                    from sanitize import sanitize_text
                    sanitized = sanitize_text(raw)
                    dd = output_dir / "errors" / "debug"
                    ensure_dir(dd)
                    dst = dd / f.name
                    dst.write_text(sanitized, encoding="utf-8")
                    info["collected_path"] = str(dst.relative_to(output_dir))
                except Exception:
                    info["error"] = "read failed"
            files.append(info)

    dst = output_dir / "errors" / "debug-index.json"
    ensure_dir(dst.parent)
    dst.write_text(json.dumps(files, indent=2, ensure_ascii=False), encoding="utf-8")
    result["collected"].append({
        "name": "debug-index.json",
        "path": str(dst.relative_to(output_dir)),
        "file_count": len(files),
    })

    return result


def collect_tasks(output_dir: Path, session_id: str) -> dict:
    """Collect task state files for hang diagnosis."""
    result = {"collected": [], "missing": [], "warnings": []}
    tasks_dir = Path.home() / ".claude" / "tasks" / session_id
    if not tasks_dir.exists():
        return result

    task_files = []
    try:
        for entry in sorted(tasks_dir.iterdir()):
            if entry.name == ".lock":
                continue
            if entry.is_file() and entry.suffix == ".json":
                try:
                    data = json.loads(entry.read_text(encoding="utf-8", errors="replace"))
                    from sanitize import sanitize_value
                    data = sanitize_value(data)
                    task_files.append(data)
                except (json.JSONDecodeError, OSError):
                    task_files.append({"file": entry.name, "error": "parse failed"})
    except OSError:
        pass

    if task_files:
        dst = output_dir / "session" / "tasks-sanitized.json"
        ensure_dir(dst.parent)
        dst.write_text(json.dumps(task_files, indent=2, ensure_ascii=False), encoding="utf-8")
        result["collected"].append({
            "name": "tasks-sanitized.json",
            "path": str(dst.relative_to(output_dir)),
            "task_count": len(task_files),
        })

    return result


def collect_perf_summary(output_dir: Path, time_from_ms: int,
                         time_to_ms: int) -> dict:
    """Collect perf report summaries."""
    result = {"collected": [], "missing": [], "warnings": []}
    perf_dir = Path.home() / ".claude" / "perf-reports"
    if not perf_dir.exists():
        result["missing"].append("perf-reports/")
        return result

    summaries = []
    seen = set()
    for f in sorted(perf_dir.glob("perf-*.json"), reverse=True):
        mtime_ms = int(f.stat().st_mtime * 1000)
        if time_from_ms and mtime_ms < time_from_ms:
            continue
        if time_to_ms and mtime_ms > time_to_ms:
            continue
        base = f.stem.replace(".json", "")
        if base in seen:
            continue
        seen.add(base)
        try:
            data = json.loads(f.read_text(encoding="utf-8", errors="replace"))
            summaries.append(data)
        except (json.JSONDecodeError, OSError):
            continue
        if len(summaries) >= 10:
            break

    if summaries:
        dst = output_dir / "errors" / "perf-summary.json"
        from sanitize import sanitize_value
        sanitized = sanitize_value(summaries)
        dst.write_text(json.dumps(sanitized, indent=2, ensure_ascii=False), encoding="utf-8")
        result["collected"].append({
            "name": "perf-summary.json",
            "path": str(dst.relative_to(output_dir)),
            "report_count": len(summaries),
        })

    return result


def collect_session_env(output_dir: Path, session_id: str) -> dict:
    """Collect session environment variables (sanitized)."""
    result = {"collected": [], "missing": [], "warnings": []}
    env_dir = Path.home() / ".claude" / "session-env" / session_id
    if not env_dir.exists():
        result["missing"].append(f"session-env/{session_id}")
        return result

    env_data = {}
    for f in env_dir.iterdir():
        if f.is_file():
            try:
                val = f.read_text(encoding="utf-8", errors="replace").strip()
                env_data[f.name] = val
            except OSError:
                pass

    if env_data:
        from sanitize import sanitize_value
        env_data = sanitize_value({"env": env_data})["env"]
        dst = output_dir / "env" / "session-env-sanitized.json"
        dst.write_text(json.dumps(env_data, indent=2, ensure_ascii=False), encoding="utf-8")
        result["collected"].append({
            "name": "session-env-sanitized.json",
            "path": str(dst.relative_to(output_dir)),
        })

    return result


def collect_raw_files(output_dir: Path, include_raw: bool,
                      include_history: bool, include_file_history: bool,
                      include_commands: bool, include_backups: bool) -> dict:
    """Optionally copy raw source files to raw/ directory."""
    result = {"collected": [], "skipped": []}
    if not include_raw:
        return result

    claude_dir = Path.home() / ".claude"
    raw_dir = output_dir / "raw"
    ensure_dir(raw_dir)

    sections = {
        "settings": [claude_dir / "settings.json", claude_dir / "settings.local.json"],
        "history": [claude_dir / "history.jsonl"],
        "file-history": list((claude_dir / "file-history").iterdir()) if (claude_dir / "file-history").exists() else [],
        "commands": list((claude_dir / "commands").glob("*.md")) if (claude_dir / "commands").exists() else [],
        "backups": list((claude_dir / "backups").iterdir()) if (claude_dir / "backups").exists() else [],
    }

    enabled = {
        "settings": True,  # always include if raw
        "history": include_history,
        "file-history": include_file_history,
        "commands": include_commands,
        "backups": include_backups,
    }

    for section, files in sections.items():
        if not enabled[section]:
            result["skipped"].append({"source": section, "reason": "not enabled"})
            continue
        for src in files:
            if src.exists() and src.is_file():
                dst = raw_dir / section / src.name
                w = copy_file_safe(src, dst)
                if w:
                    result["skipped"].append({"source": str(src), "reason": w})
                else:
                    result["collected"].append({
                        "name": f"{section}/{src.name}",
                        "path": str(dst.relative_to(output_dir)),
                        "bytes": src.stat().st_size,
                        "warning": "RAW UNSANITIZED - review before sharing",
                    })

    return result


# ── manifest / report generators ────────────────────────────────────

def generate_manifest(output_dir: Path, sections: list[dict],
                      skipped_sources: list[dict]) -> dict:
    """Generate manifest.json summarizing all collected files."""
    files = []
    for section in sections:
        for entry in section.get("collected", []):
            fp = output_dir / entry["path"]
            if fp.exists():
                entry["sha256"] = hash_file(fp)
            files.append(entry)

    missing = []
    skipped = []
    for section in sections:
        for m in section.get("missing", []):
            missing.append({"source": m, "reason": "not found"})
        for w in section.get("warnings", []):
            skipped.append({"source": w if isinstance(w, str) else "", "reason": "warning"})

    # Add explicit skipped sources
    skipped.extend(skipped_sources)

    return {
        "files": files,
        "missing_sources": missing,
        "skipped_sources": skipped,
    }


def generate_readme(output_dir: Path, metadata: dict, manifest: dict,
                    symptom: str, warnings: list[str]) -> str:
    """Generate README.md with bundle summary."""
    lines = [
        "# Claude Code Debug Bundle",
        "",
        f"**Generated**: {metadata['generated_at']}",
        f"**CSC version**: {metadata.get('csc_version', 'unknown')}",
        "",
        "## Collection Parameters",
        "",
    ]
    filters = metadata.get("filters", {})
    for k, v in filters.items():
        lines.append(f"- **{k}**: {v}")

    if symptom and symptom != "general":
        routing = SYMPTOM_ROUTING.get(symptom, {})
        lines.extend([
            "",
            "## Symptom Analysis",
            "",
            f"- **Symptom type**: {symptom} ({routing.get('description', '')})",
            f"- **Focus**: {routing.get('focus', '')}",
        ])

    lines.extend([
        "",
        "## Collected Files",
        "",
    ])
    for f in manifest.get("files", []):
        lines.append(f"- `{f.get('path', '?')}` ({f.get('bytes', 0)} bytes)")

    if manifest.get("missing_sources"):
        lines.extend([
            "",
            "## Missing Sources",
            "",
        ])
        for m in manifest["missing_sources"]:
            lines.append(f"- {m['source']}: {m['reason']}")

    if manifest.get("skipped_sources"):
        lines.extend([
            "",
            "## Skipped Sources",
            "",
        ])
        for s in manifest["skipped_sources"]:
            lines.append(f"- {s['source']}: {s['reason']}")

    if warnings:
        lines.extend([
            "",
            "## Warnings",
            "",
        ])
        for w in warnings:
            lines.append(f"- {w}")

    # Privacy notice
    has_raw = any("raw/" in f.get("path", "") for f in manifest.get("files", []))
    if has_raw:
        lines.extend([
            "",
            "## Security Notice",
            "",
            "This bundle contains raw (unsanitized) files in the `raw/` directory.",
            "Review all raw files for secrets and sensitive data before sharing.",
        ])
    else:
        lines.extend([
            "",
            "## Privacy",
            "",
            "All files in this bundle have been sanitized. Keys, tokens, emails,",
            "and home directory paths have been redacted.",
        ])

    return "\n".join(lines)


# ── main ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Collect Claude Code troubleshooting bundle",
    )
    parser.add_argument("--session", help="Session UUID to focus on")
    parser.add_argument("--time-from", help="Start time filter")
    parser.add_argument("--time-to", help="End time filter")
    parser.add_argument("--project", help="Project path")
    parser.add_argument("--rounds", type=int, default=0, help="Conversation rounds (0 = full transcript)")
    parser.add_argument("--output", help="Output directory")
    parser.add_argument("--symptom", choices=list(SYMPTOM_ROUTING.keys()) + ["general"],
                        default="general", help="Symptom type for focused collection")
    parser.add_argument("--all-projects", action="store_true")
    parser.add_argument("--include-raw", action="store_true")
    parser.add_argument("--include-debug", action="store_true")
    parser.add_argument("--include-history", action="store_true")
    parser.add_argument("--include-commands", action="store_true")
    parser.add_argument("--include-backups", action="store_true")
    parser.add_argument("--include-file-history", action="store_true")
    parser.add_argument("--archive", action="store_true", default=True)
    parser.add_argument("--no-archive", action="store_true", help="Skip zip creation")
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--user-description", default="", help="User's description of the issue")
    args = parser.parse_args()

    # ── resolve parameters ───────────────────────────────────────

    project_path = args.project or os.getcwd()
    time_from_ms = parse_time(args.time_from)
    time_to_ms = parse_time(args.time_to)
    now_ms = int(datetime.now().timestamp() * 1000)

    if not time_from_ms:
        time_from_ms = int((datetime.now() - timedelta(hours=24)).timestamp() * 1000)
    if not time_to_ms:
        time_to_ms = now_ms

    # Apply symptom routing to adjust parameters
    params = apply_symptom_routing(args.symptom, {})
    if "rounds" not in params and args.rounds != 0:
        params["rounds"] = args.rounds
    if params.get("rounds") is not None:
        args.rounds = params["rounds"]
    for flag in ("include_history", "include_debug"):
        if params.get(flag):
            setattr(args, flag, True)

    # Apply time window multiplier from symptom routing
    tw_mult = params.get("time_window_multiplier", 1.0)
    if tw_mult != 1.0 and not args.time_from:
        default_window_ms = now_ms - time_from_ms
        time_from_ms = int(now_ms - default_window_ms * tw_mult)

    # Claude project directory name
    def _path_to_claude_name(p: str) -> str:
        abs_path = str(Path(p).resolve())
        parts = abs_path.replace("\\", "/").strip("/").split("/")
        return "-" + "-".join(parts)

    proj_claude_name = _path_to_claude_name(project_path)
    project_dir = Path.home() / ".claude" / "projects" / proj_claude_name

    # Session resolution
    session_id = args.session
    explicit_session = bool(session_id)  # True when user explicitly specifies --session
    if not session_id:
        # Try to find current session
        sessions_dir = Path.home() / ".claude" / "sessions"
        best = None
        if sessions_dir.exists():
            for sf in sorted(sessions_dir.glob("*.json"),
                             key=lambda p: p.stat().st_mtime, reverse=True):
                try:
                    sd = json.loads(sf.read_text())
                    if sd.get("status") in ("busy", "idle"):
                        best = sd.get("sessionId")
                        break
                except (json.JSONDecodeError, OSError):
                    continue
        if not best and project_dir.exists():
            jsonls = sorted(project_dir.glob("*.jsonl"),
                            key=lambda p: p.stat().st_mtime, reverse=True)
            if jsonls:
                best = jsonls[0].stem
        session_id = best

    # Output directory
    if args.output:
        output_dir = Path(args.output).resolve()
    else:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_dir = Path(f"/tmp/cc-debug-bundle-{ts}")

    warnings: list[str] = []

    # ── environment ──────────────────────────────────────────────

    print("Collecting environment info...")
    env_info = {}
    try:
        result = subprocess.run(
            [sys.executable, str(_script("collect_env.py")), "--cwd", project_path],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            env_info = json.loads(result.stdout)
        else:
            warnings.append(f"collect_env.py failed: {result.stderr}")
    except Exception as exc:
        warnings.append(f"collect_env.py error: {exc}")

    env_dst = output_dir / "environment.json"
    ensure_dir(env_dst.parent)
    env_dst.write_text(json.dumps(env_info, indent=2, ensure_ascii=False), encoding="utf-8")

    csc_version = env_info.get("csc", {}).get("version") or env_info.get("claude_code", {}).get("version") or "unknown"

    # ── collect sections ─────────────────────────────────────────

    sections: list[dict] = []
    skipped_sources: list[dict] = []

    # Config
    print("Collecting configuration...")
    sections.append(collect_settings(output_dir))

    # Session transcript
    if session_id:
        # Resolve the project directory that contains this session's JSONL.
        # Strategy:
        #   1. Try the mapped project dir (from cwd) — only if it has the JSONL
        #   2. Search all project dirs for {session_id}.jsonl
        #   3. Fall back to mapped project dir anyway
        transcript_dir = None
        if project_dir.exists() and (project_dir / f"{session_id}.jsonl").exists():
            transcript_dir = project_dir
        if transcript_dir is None:
            projects_root = Path.home() / ".claude" / "projects"
            if projects_root.exists():
                for pd in sorted(projects_root.iterdir(),
                                 key=lambda p: p.stat().st_mtime, reverse=True):
                    if not pd.is_dir():
                        continue
                    if (pd / f"{session_id}.jsonl").exists():
                        transcript_dir = pd
                        break
        if transcript_dir is None and project_dir.exists():
            transcript_dir = project_dir  # last resort: try anyway
        if transcript_dir:
            print(f"Collecting session transcript ({session_id[:8]}...)...")
            sections.append(collect_session_transcript(
                transcript_dir, output_dir, session_id,
                args.rounds, time_from_ms, time_to_ms,
                apply_time_filter=not explicit_session,
            ))
        else:
            warnings.append(f"No project directory found for session {session_id}")
            sections.append({"collected": [], "missing": [f"session transcript for {session_id}"], "warnings": []})
    else:
        warnings.append(f"No session found for project {project_path}")
        sections.append({"collected": [], "missing": ["session transcript: no session_id resolved"], "warnings": []})

    # Telemetry
    print("Collecting telemetry...")
    sections.append(collect_telemetry(output_dir, time_from_ms, time_to_ms, session_id or ""))

    # Plugins
    print("Collecting plugin inventory...")
    sections.append(collect_plugins(output_dir))

    # Hook summary
    print("Extracting hook configuration...")
    sections.append(collect_hook_summary(output_dir))

    # Shell snapshots (for symptoms that benefit from environment context)
    if args.symptom in ("hook_failure", "startup_crash", "general"):
        sections.append(collect_shell_snapshot(output_dir, time_from_ms, time_to_ms))

    # Debug index
    sections.append(collect_debug_index(output_dir, args.include_debug))

    # Perf summary
    sections.append(collect_perf_summary(output_dir, time_from_ms, time_to_ms))

    # Session env
    if session_id:
        sections.append(collect_session_env(output_dir, session_id))

    # Tasks (for hang / general diagnosis)
    if session_id and args.symptom in ("hang", "general"):
        sections.append(collect_tasks(output_dir, session_id))

    # Session states — collect full sanitized session metadata files
    sessions_dir = Path.home() / ".claude" / "sessions"
    session_state_result = {"collected": [], "missing": [], "warnings": []}
    if sessions_dir.exists():
        session_state_dir = output_dir / "session"
        ensure_dir(session_state_dir)
        for sf in sorted(sessions_dir.glob("*.json"),
                         key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                raw = sf.read_text(encoding="utf-8", errors="replace")
                from sanitize import sanitize_json
                sanitized = sanitize_json(raw)
                dst = session_state_dir / sf.name
                dst.write_text(sanitized, encoding="utf-8")
                session_state_result["collected"].append({
                    "name": sf.name,
                    "path": str(dst.relative_to(output_dir)),
                    "bytes": len(sanitized.encode("utf-8")),
                })
            except (json.JSONDecodeError, OSError):
                session_state_result["warnings"].append(f"Failed to read/sanitize sessions/{sf.name}")
        # Also build a lightweight index for quick overview
        idx_entries = []
        for entry in session_state_result["collected"]:
            fp = output_dir / entry["path"]
            try:
                data = json.loads(fp.read_text(encoding="utf-8"))
                idx_entries.append({
                    "pid": data.get("pid"),
                    "sessionId": data.get("sessionId"),
                    "cwd": data.get("cwd"),
                    "startedAt": data.get("startedAt"),
                    "updatedAt": data.get("updatedAt"),
                    "status": data.get("status"),
                    "kind": data.get("kind"),
                    "name": data.get("name"),
                })
            except (json.JSONDecodeError, OSError):
                pass
        if idx_entries:
            idx_dst = session_state_dir / "sessions-index.json"
            idx_dst.write_text(json.dumps(idx_entries, indent=2, ensure_ascii=False), encoding="utf-8")
            session_state_result["collected"].append({
                "name": "sessions-index.json",
                "path": str(idx_dst.relative_to(output_dir)),
                "entry_count": len(idx_entries),
            })
    else:
        session_state_result["missing"].append("sessions/")
    sections.append(session_state_result)

    # Raw files
    print("Collecting raw files (if enabled)...")
    raw_result = collect_raw_files(
        output_dir, args.include_raw, args.include_history,
        args.include_file_history, args.include_commands, args.include_backups
    )
    sections.append(raw_result)
    skipped_sources.extend(raw_result.get("skipped", []))

    # ── metadata ─────────────────────────────────────────────────

    metadata = {
        "schema_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generator": {"skill": "cc-troubleshoot", "script": "collect_bundle.py"},
        "csc_version": csc_version,
        "filters": {
            "session_id": session_id,
            "time_from": datetime.fromtimestamp(time_from_ms/1000).isoformat() if time_from_ms else None,
            "time_to": datetime.fromtimestamp(time_to_ms/1000).isoformat() if time_to_ms else None,
            "project": project_path,
            "rounds": args.rounds,
            "all_projects": args.all_projects,
            "include_raw": args.include_raw,
            "symptom": args.symptom,
        },
        "redaction": {"enabled": True, "rules_version": "1.0"},
        "user_description": args.user_description,
        "warnings": warnings,
    }

    # ── manifest ─────────────────────────────────────────────────

    manifest = generate_manifest(output_dir, sections, skipped_sources)

    # ── README ───────────────────────────────────────────────────

    readme = generate_readme(output_dir, metadata, manifest, args.symptom, warnings)
    readme_dst = output_dir / "README.md"
    readme_dst.write_text(readme, encoding="utf-8")

    # ── bundle-metadata.json ─────────────────────────────────────

    metadata_dst = output_dir / "bundle-metadata.json"
    metadata_dst.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")

    # ── manifest.json ────────────────────────────────────────────

    manifest_dst = output_dir / "manifest.json"
    manifest_dst.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    # ── validate ─────────────────────────────────────────────────

    print("Validating bundle...")
    try:
        result = subprocess.run(
            [sys.executable, str(_script("validate_bundle.py")),
             "--bundle-dir", str(output_dir), "--lenient"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            (output_dir / "validation-report.json").write_text(result.stdout, encoding="utf-8")
        else:
            warnings.append(f"Validation warnings: {result.stderr}")
            if result.stdout:
                (output_dir / "validation-report.json").write_text(result.stdout, encoding="utf-8")
    except Exception as exc:
        warnings.append(f"Validation error: {exc}")

    # ── archive ──────────────────────────────────────────────────

    zip_path = None
    if args.archive and not args.no_archive:
        print("Creating archive...")
        zip_path = output_dir.parent / f"{output_dir.name}.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(output_dir):
                for fn in files:
                    fp = Path(root) / fn
                    arcname = fp.relative_to(output_dir.parent)
                    zf.write(fp, arcname)

    # ── report ───────────────────────────────────────────────────

    print()
    print("=" * 60)
    print("Claude Code Debug Bundle")
    print("=" * 60)
    print(f"Output: {output_dir}")
    if zip_path:
        print(f"Archive: {zip_path}")
    print(f"Session: {session_id[:8] if session_id else 'N/A'}...")
    print(f"Symptom: {args.symptom}")
    print(f"Files collected: {len(manifest['files'])}")
    print(f"Sources missing: {len(manifest['missing_sources'])}")

    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings[:10]:
            print(f"  - {w}")

    if not args.no_open and output_dir.exists():
        system = __import__("platform").system()
        if system == "Darwin":
            subprocess.run(["open", str(output_dir)])
        elif system == "Linux":
            subprocess.run(["xdg-open", str(output_dir)], capture_output=True)
        elif system == "Windows":
            os.startfile(str(output_dir))

    print("\nDone. Review README.md before sharing.")


if __name__ == "__main__":
    main()
