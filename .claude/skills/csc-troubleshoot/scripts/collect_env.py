#!/usr/bin/env python3
"""Collect cross-platform environment information for Claude Code troubleshooting.

Outputs a JSON object with OS, Node, Claude Code, Shell, Terminal, Git, and
allowlisted environment variable information.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def _run(cmd: list[str], timeout: float = 10) -> tuple[int, str, str]:
    """Run a command and return (returncode, stdout, stderr)."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except FileNotFoundError:
        return -1, "", "command not found"
    except subprocess.TimeoutExpired:
        return -2, "", "timeout"
    except Exception as e:
        return -3, "", str(e)


def _which(prog: str) -> str:
    """Find a program path, cross-platform. Returns first match only."""
    if platform.system() == "Windows":
        rc, out, _ = _run(["where", prog])
    else:
        rc, out, _ = _run(["which", prog])
    if rc == 0 and out:
        # Take first line only — Windows where may return multiple entries
        return out.split("\n")[0].strip()
    return ""


def _hash_stable(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:8]


def collect_os() -> dict:
    return {
        "system": platform.system(),
        "release": platform.release(),
        "version": platform.version(),
        "arch": platform.machine(),
        "hostname_hash": _hash_stable(platform.node()),
        "user_hash": _hash_stable(os.environ.get("USER", os.environ.get("USERNAME", ""))),
    }


def collect_node() -> dict:
    rc, version, _ = _run(["node", "--version"])
    path = _which("node")
    npm_rc, npm_ver, _ = _run(["npm", "--version"])
    if npm_rc != 0:
        # Try npm.cmd on Windows
        npm_rc, npm_ver, _ = _run(["npm.cmd", "--version"])
    return {
        "version": version if rc == 0 else None,
        "path": path,
        "npm_version": npm_ver if npm_rc == 0 else None,
    }


def collect_csc() -> dict:
    """Collect CSC / CoStrict CLI version information."""
    # Try csc first (newer name), fall back to costrict, then claude
    rc, version, _ = _run(["csc", "--version"])
    path = _which("csc")
    if rc != 0:
        rc, version, _ = _run(["costrict", "--version"])
        path = _which("costrict")
    ver_detail = {}
    if rc == 0:
        ver_detail["raw"] = version
    return {
        "version": version if rc == 0 else None,
        "path": path,
        "detail": ver_detail,
    }


def collect_claude_code() -> dict:
    """Collect underlying Claude Code CLI version (legacy)."""
    rc, version, _ = _run(["claude", "--version"])
    path = _which("claude")
    ver_detail = {}
    if rc == 0:
        ver_detail["raw"] = version
    return {
        "version": version if rc == 0 else None,
        "path": path,
        "detail": ver_detail,
    }


def collect_python() -> dict:
    rc, version, _ = _run(["python3", "--version"])
    path = _which("python3")
    if rc != 0:
        rc, version, _ = _run(["python", "--version"])
        path = _which("python")
    return {
        "version": version if rc == 0 else None,
        "path": path,
    }


def collect_shell() -> dict:
    shell_path = os.environ.get("SHELL", os.environ.get("COMSPEC", ""))
    shell_type = ""
    if shell_path:
        shell_type = Path(shell_path).name
    return {
        "type": shell_type,
        "path": shell_path,
        "version": os.environ.get("BASH_VERSION", os.environ.get("ZSH_VERSION", "")),
    }


def collect_terminal() -> dict:
    return {
        "term": os.environ.get("TERM", ""),
        "program": os.environ.get("TERM_PROGRAM", ""),
        "session_id": os.environ.get("TERM_SESSION_ID", ""),
        "columns": os.environ.get("COLUMNS", ""),
        "lines": os.environ.get("LINES", ""),
    }


def collect_git(cwd: str) -> dict:
    git_info = {
        "available": False,
        "branch": None,
        "head_hash": None,
        "remote": None,
        "status": None,
        "dirty": None,
    }

    rc, _, _ = _run(["git", "--version"])
    if rc != 0:
        return git_info

    git_info["available"] = True

    # Branch
    rc, branch, _ = _run(["git", "branch", "--show-current"], timeout=5)
    if rc == 0:
        git_info["branch"] = branch

    # HEAD hash
    rc, head, _ = _run(["git", "rev-parse", "--short", "HEAD"], timeout=5)
    if rc == 0:
        git_info["head_hash"] = head

    # Remote URL (sanitize — keep domain only)
    rc, remote, _ = _run(["git", "remote", "get-url", "origin"], timeout=5)
    if rc == 0:
        # Sanitize: keep only domain/path, strip credentials
        import re
        remote = re.sub(r"https?://[^@]*@", "https://[REDACTED]@", remote)
        git_info["remote"] = remote

    # Status
    rc, status, _ = _run(["git", "status", "--short", "--branch"], timeout=5)
    if rc == 0:
        lines = status.split("\n")
        git_info["dirty"] = len([l for l in lines if l.strip() and not l.startswith("#")]) > 0
        git_info["status_summary"] = status[:500]  # truncate

    return git_info


def collect_env_vars() -> dict:
    """Collect allowlisted environment variable names and sanitized values."""
    allowed_prefixes = ["CLAUDE_", "ANTHROPIC_", "NODE_"]
    allowed_names = {"SHELL", "TERM", "TERM_PROGRAM", "PATH", "HOME", "USER", "LANG", "LC_ALL"}

    env_info = {}
    for key, value in sorted(os.environ.items()):
        if key in allowed_names or any(key.startswith(p) for p in allowed_prefixes):
            if key == "PATH":
                # List path segments with home redacted
                home = os.path.expanduser("~")
                segments = value.split(os.pathsep)
                segments = [s.replace(home, "~") for s in segments]
                env_info[key] = segments
            elif key in ("HOME", "USER"):
                env_info[key] = "[REDACTED]"
            elif "KEY" in key.upper() or "TOKEN" in key.upper() or "SECRET" in key.upper():
                env_info[key] = "[REDACTED]"
            else:
                env_info[key] = value

    return env_info


def collect(cwd: str = None) -> dict:
    if cwd is None:
        cwd = os.getcwd()

    return {
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "os": collect_os(),
        "csc": collect_csc(),
        "claude_code": collect_claude_code(),
        "node": collect_node(),
        "python": collect_python(),
        "shell": collect_shell(),
        "terminal": collect_terminal(),
        "git": collect_git(cwd),
        "cwd": cwd,
        "claude_config_dir": str(Path.home() / ".claude"),
        "claude_config_exists": (Path.home() / ".claude").exists(),
        "env_vars": collect_env_vars(),
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Collect environment info for Claude Code troubleshooting"
    )
    parser.add_argument("--cwd", help="Working directory (default: current)")
    parser.add_argument("--json", action="store_true", help="Output JSON (always)")
    args = parser.parse_args()

    data = collect(args.cwd)
    print(json.dumps(data, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
