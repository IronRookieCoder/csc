#!/usr/bin/env python3
"""Unified sanitizer for Claude Code debug bundles.

Handles JSON, JSONL, env exports, shell scripts, markdown, and plain text.
Detects sensitive field names, value patterns (API keys, tokens, JWTs, private keys,
URL credentials, emails, home directories), and replaces them with stable redacted forms.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# ── field-name rules ──────────────────────────────────────────────
SENSITIVE_FIELD_KEYWORDS = [
    "key", "token", "secret", "password", "passwd", "credential",
    "authorization", "cookie", "session_token", "session_secret",
    "session_cookie", "private", "cert",
]

# Fields that contain "env" but are actually env-variable objects (whole object gets scanned)
ENV_FIELD_NAMES = {"env", "environment", "env_vars", "envVars", "processEnv"}

# Fields whose value should NOT be redacted even if field-name is sensitive.
# Only match clearly non-sensitive enum-like values to avoid weaking redaction.
SAFE_SENSITIVE_VALUE_PATTERNS = re.compile(
    r"^(true|false|null|none|undefined|yes|no|on|off|auto|json|text|md|csv|yaml|xml|"
    r"error|warn|info|debug|trace|fatal|"
    r"success|failure|pending|active|idle|busy|"
    r"\d+\.?\d*|"
    r"[a-zA-Z]{1,8})$",
    re.IGNORECASE
)

# Fields that should always be kept (never redacted by name alone)
ALLOWLIST_FIELD_NAMES = {
    "session_id", "uuid", "pid", "id", "parentUuid", "sessionId",
    "slug", "name", "display", "kind", "status", "type", "agentType",
    "entrypoint", "project", "cwd", "version", "peerProtocol",
    "gitBranch", "gateway", "baseUrl", "url", "endpoint", "host",
    "path", "file_path", "source", "mtime", "bytes", "sha256",
    "generated_at", "schema_version", "time_from", "time_to",
}

# ── value-pattern rules ────────────────────────────────────────────
# Compiled patterns that match regardless of field name.

# API key prefixes
API_KEY_RE = re.compile(
    r"\b(sk-(?:ant(?:-api)?)?-[a-zA-Z0-9_\-]{20,})\b"
    r"|\b(xox[bpsa]-[a-zA-Z0-9_\-]{20,})\b"
    r"|\b(ghp_[a-zA-Z0-9]{36,})\b"
    r"|\b(github_pat_[a-zA-Z0-9_]{40,})\b",
)

# Bearer tokens
BEARER_RE = re.compile(r"Bearer\s+([a-zA-Z0-9_\-\.=]{20,})", re.IGNORECASE)

# JWT (three base64url segments separated by dots)
JWT_RE = re.compile(
    r"\b(eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,})\b"
)

# Private key blocks (PEM)
PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|DSA\s+)?PRIVATE\s+KEY-----"
    r"[\s\S]*?"
    r"-----END\s+(?:RSA\s+|EC\s+|OPENSSH\s+|DSA\s+)?PRIVATE\s+KEY-----"
)

# URL credentials
URL_CRED_RE = re.compile(r"(https?://)[^\s\"'<>:@]+:[^\s\"'<>@]+@")

# Email (hash local part, keep domain)
EMAIL_RE = re.compile(r"\b([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b")

# Home directory paths
HOME_DIR = os.path.expanduser("~")
HOME_RE = re.compile(re.escape(HOME_DIR), re.IGNORECASE)

# Generic high-entropy token patterns (40+ char hex or base64 strings)
GENERIC_TOKEN_RE = re.compile(r"\b([a-zA-Z0-9_\-+/=]{40,})\b")

# ── redaction helpers ──────────────────────────────────────────────

def _hash_stable(value: str, prefix: str = "") -> str:
    """Stable 4-char hex hash of value."""
    h = hashlib.sha256(value.encode()).hexdigest()[:4]
    return f"{prefix}{h}"


def redact_short() -> str:
    return "[REDACTED]"


def redact_token(value: str) -> str:
    if len(value) <= 8:
        return "[REDACTED]"
    return f"{value[:4]}...{value[-4:]}"


def redact_multiline() -> str:
    return "[REDACTED_MULTILINE_SECRET]"


def redact_email(local: str, domain: str) -> str:
    return f"{_hash_stable(local, 'user_')}@{domain}"


def redact_home() -> str:
    return "~"


def _is_sensitive_field_name(name: str) -> bool:
    """Check if a field name should trigger value redaction."""
    nl = name.lower().replace("-", "_")
    if nl in ALLOWLIST_FIELD_NAMES:
        return False
    for kw in SENSITIVE_FIELD_KEYWORDS:
        if kw in nl:
            return True
    return False


def _redact_value_by_name(field_name: str, value: Any) -> tuple[bool, Any]:
    """Redact a value based on field name. Returns (changed, new_value)."""
    if not isinstance(value, str):
        return False, value
    if not _is_sensitive_field_name(field_name):
        return False, value
    # Check if it looks like a harmless enum / identifier
    if SAFE_SENSITIVE_VALUE_PATTERNS.match(value):
        return False, value
    return True, redact_token(value) if len(value) > 8 else redact_short()


def _redact_value_by_pattern(value: str) -> tuple[bool, str]:
    """Redact a string value by pattern matching. Returns (changed, new_value)."""
    if not isinstance(value, str):
        return False, value
    changed = False

    # Private keys first (multi-line)
    if PRIVATE_KEY_RE.search(value):
        value = PRIVATE_KEY_RE.sub(redact_multiline(), value)
        changed = True

    # URL credentials
    if URL_CRED_RE.search(value):
        value = URL_CRED_RE.sub(r"\1[REDACTED]:[REDACTED]@", value)
        changed = True

    # API keys
    match = API_KEY_RE.search(value)
    if match:
        key_val = match.group(0)
        value = value.replace(key_val, redact_token(key_val))
        changed = True

    # Bearer tokens
    match = BEARER_RE.search(value)
    if match:
        tok = match.group(1)
        value = value.replace(tok, redact_token(tok))
        changed = True

    # JWTs
    match = JWT_RE.search(value)
    if match:
        tok = match.group(1)
        value = value.replace(tok, redact_token(tok))
        changed = True

    # Emails
    value = EMAIL_RE.sub(
        lambda m: redact_email(m.group(1), m.group(2)), value
    )
    # Only mark changed if we actually found emails
    # (EMAIL_RE.sub is a no-op if no match, but let's check)
    if "@" in value and EMAIL_RE.search(value) is None:
        pass  # already handled
    # Re-scan to see if emails were present
    # Simpler: just run it, the changed flag for email is hard to detect
    # We'll call it changed if HOME_RE matches below or rely on the caller.

    # Home directory
    if HOME_DIR and HOME_DIR in value:
        value = HOME_RE.sub(redact_home(), value)
        changed = True

    return changed, value


# ── recursive JSON / dict walker ───────────────────────────────────

def sanitize_value(obj: Any, field_name: str = "") -> Any:
    """Recursively sanitize a JSON-compatible value."""
    if isinstance(obj, dict):
        # Special handling for env objects: sanitize every value
        is_env_obj = field_name.lower().replace("-", "_") in ENV_FIELD_NAMES
        result = {}
        for k, v in obj.items():
            if is_env_obj:
                if isinstance(v, str):
                    _, v = _redact_value_by_pattern(v)
                    if len(v) > 8:
                        v = redact_token(v)
                    else:
                        v = redact_short()
                elif isinstance(v, (dict, list)):
                    v = sanitize_value(v, k)
            else:
                v = sanitize_value(v, k)
            result[k] = v
        return result

    if isinstance(obj, list):
        return [sanitize_value(item, field_name) for item in obj]

    if isinstance(obj, str):
        # 1st: field-name-based redaction
        changed, val = _redact_value_by_name(field_name, obj)
        if changed:
            return val
        # 2nd: pattern-based redaction
        changed, val = _redact_value_by_pattern(val)
        if changed:
            return val
        # 3rd: generic token detection for very long strings
        if len(val) > 60:
            # Check entropy heuristics: high ratio of hex/base64 chars
            alpha = sum(1 for c in val if c.isalnum() or c in "+/=-_")
            if alpha / max(len(val), 1) > 0.85:
                return redact_token(val)
        return val

    return obj


# ── text / env / shell sanitizers ──────────────────────────────────

def sanitize_env_line(line: str) -> str:
    """Sanitize a single env export line (export FOO=bar or FOO=bar)."""
    # Match: optional 'export ', KEY=VALUE
    m = re.match(r"(export\s+)?(\w+)=(.*)", line)
    if not m:
        # Could be a comment or blank line
        return line
    prefix = m.group(1) or ""
    key = m.group(2)
    val = m.group(3)

    # Strip quotes
    raw_val = val.strip().strip("'\"")

    # Check field name
    if _is_sensitive_field_name(key):
        return f"{prefix}{key}=[REDACTED]"

    # Pattern check on value
    changed, new_val = _redact_value_by_pattern(raw_val)
    if changed:
        # Preserve quoting style
        if val.startswith('"'):
            return f'{prefix}{key}="{new_val}"'
        elif val.startswith("'"):
            return f"{prefix}{key}='{new_val}'"
        else:
            return f"{prefix}{key}={new_val}"

    return line


def sanitize_text(text: str) -> str:
    """Sanitize arbitrary text content (shell snapshots, markdown, etc.)."""
    lines = text.split("\n")
    result_lines = []
    for line in lines:
        # Check if it looks like an env assignment
        if "=" in line and not line.strip().startswith(("#", "//", "/*", "*", "-", ">")):
            # Only if it has a simple KEY=VALUE structure
            m = re.match(r"^(\w+)=(.+)$", line.strip())
            if m:
                key = m.group(1)
                val = m.group(2)
                if _is_sensitive_field_name(key):
                    result_lines.append(f"{key}=[REDACTED]")
                    continue
                changed, new_val = _redact_value_by_pattern(val)
                if changed:
                    result_lines.append(f"{key}={new_val}")
                    continue
            # Also check for export style
            em = re.match(r"^export\s+(\w+)=(.+)$", line.strip())
            if em:
                key = em.group(1)
                val = em.group(2)
                if _is_sensitive_field_name(key):
                    result_lines.append(f"export {key}=[REDACTED]")
                    continue
                changed, new_val = _redact_value_by_pattern(val)
                if changed:
                    result_lines.append(f"export {key}={new_val}")
                    continue

        # Pattern-based redaction on the whole line
        _, line = _redact_value_by_pattern(line)
        result_lines.append(line)

    return "\n".join(result_lines)


def sanitize_json(data: str) -> str:
    """Sanitize a JSON document."""
    try:
        obj = json.loads(data)
        obj = sanitize_value(obj)
        return json.dumps(obj, indent=2, ensure_ascii=False)
    except json.JSONDecodeError:
        # Fall back to text sanitization
        return sanitize_text(data)


def sanitize_jsonl(data: str) -> str:
    """Sanitize a JSONL document (one JSON object per line)."""
    lines = data.split("\n")
    result = []
    for line in lines:
        line = line.strip()
        if not line:
            result.append(line)
            continue
        try:
            obj = json.loads(line)
            obj = sanitize_value(obj)
            result.append(json.dumps(obj, ensure_ascii=False))
        except json.JSONDecodeError:
            result.append(sanitize_text(line))
    return "\n".join(result)


# ── file-level entry points ────────────────────────────────────────

def sanitize_file(input_path: str, output_path: str, kind: str = "auto") -> dict:
    """Sanitize a file. Returns stats dict."""
    input_path = Path(input_path)
    output_path = Path(output_path)

    if not input_path.exists():
        return {"error": f"file not found: {input_path}", "bytes_in": 0, "bytes_out": 0}

    raw = input_path.read_text(encoding="utf-8", errors="replace")
    size_in = len(raw.encode("utf-8"))

    if kind == "auto":
        suffix = input_path.suffix.lower()
        if suffix in (".json",):
            kind = "json"
        elif suffix in (".jsonl",):
            kind = "jsonl"
        elif suffix in (".sh", ".bash", ".zsh", ".env", ".txt"):
            kind = "text"
        elif suffix in (".md",):
            kind = "text"
        else:
            kind = "text"

    if kind == "json":
        out = sanitize_json(raw)
    elif kind == "jsonl":
        out = sanitize_jsonl(raw)
    else:
        out = sanitize_text(raw)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(out, encoding="utf-8")
    size_out = len(out.encode("utf-8"))

    return {"bytes_in": size_in, "bytes_out": size_out, "kind": kind}


def sanitize_string(data: str, kind: str = "text") -> str:
    """Sanitize a string in-place, return sanitized version."""
    if kind == "json":
        return sanitize_json(data)
    elif kind == "jsonl":
        return sanitize_jsonl(data)
    else:
        return sanitize_text(data)


# ── CLI ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Sanitize sensitive data from files")
    parser.add_argument("input", help="Input file path")
    parser.add_argument("output", help="Output file path")
    parser.add_argument(
        "--kind", choices=["auto", "json", "jsonl", "text"], default="auto",
        help="Input format (default: auto-detect from extension)"
    )
    args = parser.parse_args()

    stats = sanitize_file(args.input, args.output, args.kind)
    if "error" in stats:
        print(f"ERROR: {stats['error']}", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
