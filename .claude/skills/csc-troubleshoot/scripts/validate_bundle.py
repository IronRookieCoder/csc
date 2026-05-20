#!/usr/bin/env python3
"""Validate a Claude Code debug bundle for correctness, completeness, and safety.

Checks:
  - Bundle directory structure integrity
  - manifest.json consistency (files exist, sizes match)
  - Sanitization markers (no raw keys in sanitized files)
  - JSON/JSONL parseability
  - Raw file isolation (raw files only under raw/)
  - README.md presence
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


# ── patterns that MUST NOT appear in sanitized output ───────────────

FORBIDDEN_PATTERNS = [
    # Anthropic API keys
    re.compile(r"sk-ant-[a-zA-Z0-9_\-]{20,}"),
    # OpenAI API keys
    re.compile(r"sk-[a-zA-Z0-9_\-]{20,}"),
    # Slack tokens
    re.compile(r"xox[bpsa]-[a-zA-Z0-9_\-]{20,}"),
    # GitHub tokens
    re.compile(r"ghp_[a-zA-Z0-9]{36,}"),
    re.compile(r"github_pat_[a-zA-Z0-9_]{40,}"),
    # JWT
    re.compile(r"eyJ[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}"),
    # Private keys
    re.compile(r"-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|DSA\s+)?PRIVATE\s+KEY-----"),
    # URL credentials
    re.compile(r"https?://[^\s\"'<>:@]+:[^\s\"'<>@]+@"),
    # Bearer tokens (long ones)
    re.compile(r"Bearer\s+[a-zA-Z0-9_\-\.=]{30,}"),
]


EXPECTED_STRUCTURE = {
    "README.md": "file",
    "manifest.json": "file",
    "bundle-metadata.json": "file",
    "environment.json": "file",
    "summary": "dir",
    "config": "dir",
    "session": "dir",
    "errors": "dir",
    "hooks": "dir",
    "plugins": "dir",
}

# Symptom-critical data sources that must be present (error if missing)
SYMPTOM_REQUIRED_SOURCES = {
    "tool_error": [
        {"path_pattern": "session/transcript-sanitized.jsonl", "min_bytes": 20,
         "message": "缺少会话转录 — tool_error 症状的核心数据源"},
    ],
    "hook_failure": [
        {"path_pattern": "hooks/hook-summary.json", "min_bytes": 10,
         "message": "缺少 Hook 配置摘要"},
        {"path_pattern": "config/settings-sanitized.json", "min_bytes": 10,
         "message": "缺少配置文件"},
    ],
    "hang": [
        {"path_pattern": "session/transcript-sanitized.jsonl", "min_bytes": 20,
         "message": "缺少会话转录 — hang 症状的核心数据源"},
    ],
    "permission": [
        {"path_pattern": "config/settings-sanitized.json", "min_bytes": 10,
         "message": "缺少配置文件 — permission 症状需要检查权限配置"},
    ],
    "api_error": [
        {"path_pattern": "session/transcript-sanitized.jsonl", "min_bytes": 20,
         "message": "缺少会话转录 — api_error 症状需要检查 API 调用记录"},
    ],
    "session_lost": [
        {"path_pattern": "session/sessions-index.json", "min_bytes": 10,
         "message": "缺少会话索引 — session_lost 症状的核心数据源"},
    ],
    "startup_crash": [
        {"path_pattern": "config/settings-sanitized.json", "min_bytes": 10,
         "message": "缺少配置文件 — startup_crash 症状需要检查配置"},
    ],
    "plugin": [
        {"path_pattern": "plugins/plugins-list.json", "min_bytes": 10,
         "message": "缺少插件清单 — plugin 症状的核心数据源"},
    ],
}


def check_structure(bundle_dir: Path) -> list[dict]:
    """Check that expected directories and files exist."""
    issues = []
    for name, kind in EXPECTED_STRUCTURE.items():
        path = bundle_dir / name
        if kind == "file" and not path.is_file():
            issues.append({"level": "warning", "item": name, "message": "missing file"})
        elif kind == "dir" and not path.is_dir():
            issues.append({"level": "warning", "item": name, "message": "missing directory"})
    return issues


def check_manifest(bundle_dir: Path) -> list[dict]:
    """Verify manifest.json entries match actual files."""
    issues = []
    manifest_path = bundle_dir / "manifest.json"
    if not manifest_path.exists():
        return issues

    try:
        manifest = json.loads(manifest_path.read_text())
    except (json.JSONDecodeError, OSError) as e:
        return [{"level": "error", "item": "manifest.json", "message": f"parse error: {e}"}]

    for entry in manifest.get("files", []):
        fp = bundle_dir / entry.get("path", "")
        if not fp.exists():
            issues.append({
                "level": "warning",
                "item": entry.get("path", "?"),
                "message": "listed in manifest but not on disk",
            })
        else:
            actual_size = fp.stat().st_size
            expected_size = entry.get("bytes", 0)
            if expected_size and abs(actual_size - expected_size) > 100:
                issues.append({
                    "level": "info",
                    "item": entry.get("path", "?"),
                    "message": f"size mismatch: manifest={expected_size}, disk={actual_size}",
                })

    return issues


def scan_for_secrets(content: str, file_path: str, is_raw: bool) -> list[dict]:
    """Scan content for residual secrets."""
    issues = []
    for pattern in FORBIDDEN_PATTERNS:
        matches = pattern.findall(content)
        if matches:
            if is_raw:
                level = "info"
                msg = f"raw file contains expected secret patterns ({len(matches)} matches)"
            else:
                level = "error"
                msg = f"sanitized file contains SECRET PATTERN ({len(matches)} matches)"
            issues.append({
                "level": level,
                "item": file_path,
                "message": msg,
            })
    return issues


def check_json_parseable(content: str, file_path: str) -> list[dict]:
    """Check if JSON/JSONL content is parseable."""
    issues = []
    if file_path.endswith(".json"):
        try:
            json.loads(content)
        except json.JSONDecodeError as e:
            issues.append({
                "level": "warning",
                "item": file_path,
                "message": f"JSON parse error: {e}",
            })
    elif file_path.endswith(".jsonl"):
        for i, line in enumerate(content.split("\n"), 1):
            line = line.strip()
            if not line:
                continue
            try:
                json.loads(line)
            except json.JSONDecodeError:
                issues.append({
                    "level": "warning",
                    "item": file_path,
                    "message": f"JSONL parse error at line {i}",
                })
    return issues


def check_raw_isolation(bundle_dir: Path) -> list[dict]:
    """Ensure non-raw files are not under a raw/ equivalent."""
    issues = []
    raw_dir = bundle_dir / "raw"
    if not raw_dir.exists():
        return issues

    # Any file with "raw" or "unsanitized" in path that's NOT under raw/ is suspicious
    for entry in bundle_dir.rglob("*"):
        if entry.is_file() and not str(entry.relative_to(bundle_dir)).startswith("raw"):
            if "unsanitized" in entry.name.lower():
                issues.append({
                    "level": "warning",
                    "item": str(entry.relative_to(bundle_dir)),
                    "message": "suspicious file name outside raw/",
                })

    return issues


def check_completeness(bundle_dir: Path) -> list[dict]:
    """Verify that symptom-critical data sources were actually collected."""
    issues = []

    # Read bundle metadata to get symptom
    metadata_path = bundle_dir / "bundle-metadata.json"
    if not metadata_path.exists():
        return issues

    try:
        metadata = json.loads(metadata_path.read_text())
    except (json.JSONDecodeError, OSError):
        return issues

    symptom = metadata.get("filters", {}).get("symptom", "general")
    if symptom not in SYMPTOM_REQUIRED_SOURCES:
        return issues

    # Read manifest to check what was actually collected
    manifest_path = bundle_dir / "manifest.json"
    manifest_files = []
    skipped_sources = []
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
            manifest_files = manifest.get("files", [])
            skipped_sources = manifest.get("skipped_sources", [])
        except (json.JSONDecodeError, OSError):
            pass

    for required in SYMPTOM_REQUIRED_SOURCES[symptom]:
        found = False
        for f in manifest_files:
            if f.get("path") == required["path_pattern"]:
                if f.get("bytes", 0) >= required.get("min_bytes", 0):
                    found = True
                break
        if not found:
            issues.append({
                "level": "error",
                "item": required["path_pattern"],
                "message": required["message"],
            })

    # Elevate critical skipped_sources to errors
    for s in skipped_sources:
        source = s.get("source", "")
        if "no entries matched" in source.lower():
            issues.append({
                "level": "error",
                "item": "session transcript",
                "message": f"会话转录未收集到条目: {source}",
            })

    return issues


def validate(bundle_dir: Path, lenient: bool = False) -> dict:
    """Run all validations and return a report."""
    if not bundle_dir.exists():
        return {
            "valid": False,
            "error": f"bundle directory not found: {bundle_dir}",
            "issues": [],
            "summary": {},
        }

    all_issues = []

    # Structure
    all_issues.extend(check_structure(bundle_dir))

    # Manifest consistency
    all_issues.extend(check_manifest(bundle_dir))

    # Raw isolation
    all_issues.extend(check_raw_isolation(bundle_dir))

    # Symptom data completeness
    all_issues.extend(check_completeness(bundle_dir))

    # Scan all non-raw files for secrets
    raw_dir = bundle_dir / "raw"
    for entry in sorted(bundle_dir.rglob("*")):
        if not entry.is_file():
            continue
        rel_path = str(entry.relative_to(bundle_dir))
        is_raw = rel_path.startswith("raw") or rel_path.startswith("raw/")

        try:
            content = entry.read_text(encoding="utf-8", errors="replace")
        except OSError:
            all_issues.append({
                "level": "warning", "item": rel_path, "message": "could not read file",
            })
            continue

        # Scan for secrets (skip for raw files unless they're expected to be clean)
        all_issues.extend(scan_for_secrets(content, rel_path, is_raw))

        # Check JSON parseability
        if entry.suffix in (".json", ".jsonl"):
            all_issues.extend(check_json_parseable(content, rel_path))

    # Summarize
    errors = [i for i in all_issues if i["level"] == "error"]
    warnings = [i for i in all_issues if i["level"] == "warning"]
    infos = [i for i in all_issues if i["level"] == "info"]

    valid = len(errors) == 0
    if lenient:
        valid = True  # lenient mode: errors are still reported but don't fail

    return {
        "valid": valid,
        "mode": "lenient" if lenient else "strict",
        "summary": {
            "total_issues": len(all_issues),
            "errors": len(errors),
            "warnings": len(warnings),
            "info": len(infos),
        },
        "issues": all_issues,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate a Claude Code debug bundle")
    parser.add_argument("--bundle-dir", required=True, help="Path to the bundle directory")
    parser.add_argument("--lenient", action="store_true", help="Report errors but don't fail")
    args = parser.parse_args()

    report = validate(Path(args.bundle_dir), args.lenient)
    print(json.dumps(report, indent=2, ensure_ascii=False))

    if not report["valid"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
