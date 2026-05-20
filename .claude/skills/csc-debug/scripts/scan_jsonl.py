#!/usr/bin/env python3
"""
scan_jsonl.py — Layer 1 JSONL 诊断扫描器（格式无关版）

不依赖 JSON 层级结构（role/stop_reason 可能在顶层也可能在 message 子对象中），
通过递归搜索 + 全文回退的方式提取关键信息，对各种 CSC/Claude JSONL 格式都兼容。

覆盖检查项：
  - Check 1.1: 错误/异常消息搜索
  - Check 1.2: 最后 N 轮工具调用状态
  - Check 1.3: Token 使用趋势
  - Check 1.9: stop_reason 与 content 块一致性
  - Check 1.10: isApiErrorMessage 标记检测

用法:
  python scan_jsonl.py <path-to-transcript.jsonl> [--last-n 10]

输出: Markdown 格式诊断报告。
"""

import json
import sys
from collections import Counter
from pathlib import Path


# ── Windows GBK → UTF-8 ──────────────────────────────────────────────
def _setup_encoding():
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

_setup_encoding()


# ── 格式无关的字段提取 ────────────────────────────────────────────────
def _deep_get(d, *keys, default=None):
    """递归查找字段：先找 d 自身，再找 d.message、d["message"] 等子对象。"""
    if not isinstance(d, dict):
        return default
    for key in keys:
        if key in d:
            return d[key]
    # 递归进入常见子对象
    for sub_key in ("message", "snapshot", "toolUseResult"):
        sub = d.get(sub_key)
        if isinstance(sub, dict):
            for key in keys:
                if key in sub:
                    return sub[key]
    return default


def _extract_role(msg: dict) -> str:
    return _deep_get(msg, "role", default="?")


def _extract_type(msg: dict) -> str:
    return _deep_get(msg, "type", default="?")


def _extract_stop_reason(msg: dict) -> str:
    return _deep_get(msg, "stop_reason", default="")


def _extract_content(msg: dict):
    """返回 content，可能是 list/dict/str/None。"""
    return _deep_get(msg, "content", default=None)


def _extract_usage(msg: dict) -> dict:
    """返回 usage 字典（可能包含 input_tokens / input / output_tokens / output）。"""
    usage = _deep_get(msg, "usage", default=None)
    if usage is None:
        usage = _deep_get(msg, "token_usage", default=None)
    return usage or {}


def _has_is_api_error(msg: dict) -> bool:
    """isApiErrorMessage 通常在顶层。"""
    return bool(msg.get("isApiErrorMessage"))


# ── 内容提取辅助 ─────────────────────────────────────────────────────
def _content_text(content, max_len=200) -> str:
    """从 content（可能是 str/list/dict）中提取文本片段。"""
    if isinstance(content, str):
        return content[:max_len]
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") in ("text", "tool_result"):
                    parts.append(str(block.get("text", "")))
                elif block.get("type") == "tool_use":
                    parts.append(f"[tool_use: {block.get('name', '?')}]")
        return " | ".join(parts)[:max_len]
    if isinstance(content, dict):
        return str(content)[:max_len]
    return ""


def _content_has_tool_use(content) -> bool:
    """content 中是否包含 tool_use 块。"""
    if not isinstance(content, list):
        return False
    return any(
        isinstance(b, dict) and b.get("type") == "tool_use"
        for b in content
    )


def _content_types(content) -> list:
    """返回 content 中各 block 的 type 列表。"""
    if not isinstance(content, list):
        return [type(content).__name__]
    return [b.get("type", "?") for b in content if isinstance(b, dict)]


# ── 检查函数 ──────────────────────────────────────────────────────────

def check_errors(messages: list[dict]) -> list[dict]:
    """Check 1.1: 在原始 JSON 文本中扫描异常关键词。"""
    keywords = ["error", "fatal", "exception", "fail", "timeout", "refused", "denied"]
    findings = []
    for msg in messages:
        text = json.dumps(msg)
        text_lower = text.lower()
        hits = [kw for kw in keywords if kw in text_lower]
        if hits:
            role = _extract_role(msg)
            content = _extract_content(msg)
            findings.append({
                "type": _extract_type(msg),
                "role": role,
                "hits": hits,
                "preview": _content_text(content, 200),
            })
    return findings


def check_tool_calls(messages: list[dict], last_n: int = 10) -> list[dict]:
    """Check 1.2: 最后 N 轮工具调用配对状态。"""
    # 收集所有 assistant 消息中带 tool_use 的
    tool_messages = []
    for m in messages:
        role = _extract_role(m)
        content = _extract_content(m)
        if role == "assistant" and _content_has_tool_use(content):
            tool_messages.append(m)

    # 建立 tool_result 映射：从任意消息的 content 中提取 id → 消息
    tool_results = {}
    for m in messages:
        content = _extract_content(m)
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict):
                tr_id = None
                if block.get("type") == "tool_result":
                    tr_id = block.get("tool_use_id", "")
                elif block.get("type") == "tool_use":
                    # 可能有些格式把 tool_use 放在 user content 中表示结果
                    pass
                if tr_id:
                    tool_results[tr_id] = m

    # 也用原始文本扫描 tool_use_id 作为回退
    for m in messages:
        raw = json.dumps(m)
        # 简单扫描 "tool_use_id":"xxx" 模式
        import re
        for match in re.finditer(r'"tool_use_id"\s*:\s*"([^"]+)"', raw):
            tool_results[match.group(1)] = m

    recent = tool_messages[-last_n:]
    results = []
    for msg in recent:
        content = _extract_content(msg)
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                tool_id = block.get("id", "")
                tool_name = block.get("name", "?")
                result = tool_results.get(tool_id)
                status = "OK" if result else "NO_RESULT"
                is_error = False
                if result:
                    raw = json.dumps(result).lower()
                    is_error = "is_error" in raw or '"error"' in raw
                results.append({
                    "tool": tool_name,
                    "tool_id": tool_id,
                    "status": status,
                    "is_error": is_error,
                })
    return results


def check_stop_reason_consistency(messages: list[dict]) -> list[dict]:
    """Check 1.9: stop_reason=tool_use 但 content 中无 tool_use 块。"""
    anomalies = []
    for i, msg in enumerate(messages):
        role = _extract_role(msg)
        if role != "assistant":
            continue
        stop_reason = _extract_stop_reason(msg)
        if stop_reason != "tool_use":
            continue
        content = _extract_content(msg)
        if not isinstance(content, list):
            anomalies.append({
                "line": i + 1,
                "stop_reason": stop_reason,
                "content_types": ["<非列表>"],
                "text_preview": _content_text(content, 150),
            })
            continue
        if not _content_has_tool_use(content):
            anomalies.append({
                "line": i + 1,
                "stop_reason": stop_reason,
                "content_types": _content_types(content),
                "text_preview": _content_text(content, 150),
            })
    return anomalies


def check_api_error_markers(messages: list[dict]) -> list[dict]:
    """Check 1.10: isApiErrorMessage 标记 + 前序上下文。"""
    markers = []
    for i, msg in enumerate(messages):
        if not _has_is_api_error(msg):
            continue
        # 前溯 2-3 条 assistant 消息
        prev_assistants = []
        for j in range(i - 1, max(i - 5, 0), -1):
            prev = messages[j]
            if _extract_role(prev) == "assistant":
                prev_assistants.append({
                    "line": j + 1,
                    "stop_reason": _extract_stop_reason(prev),
                    "content_types": _content_types(_extract_content(prev) or []),
                })
        error_text = _content_text(_extract_content(msg), 300)
        markers.append({
            "line": i + 1,
            "error_text": error_text,
            "preceding_assistants": list(reversed(prev_assistants)),
        })
    return markers


def check_token_trend(messages: list[dict]) -> dict:
    """Check 1.3: Token 趋势（支持 input_tokens / input 两种字段名）。"""
    entries = []
    for msg in messages:
        usage = _extract_usage(msg)
        inp = usage.get("input_tokens") or usage.get("input", 0)
        out = usage.get("output_tokens") or usage.get("output", 0)
        if inp or out:
            entries.append({"input": inp, "output": out, "total": inp + out})

    if not entries:
        return {"count": 0, "trend": "无 token 数据"}

    totals = [e["total"] for e in entries]
    trend = "稳定"
    if len(totals) >= 3:
        if totals[-1] > totals[0] * 1.5:
            trend = "显著上升"
        elif totals[-1] > totals[0] * 1.3:
            trend = "上升"

    return {
        "count": len(entries),
        "first": totals[0],
        "last": totals[-1],
        "max": max(totals),
        "trend": trend,
    }


# ── 主入口 ────────────────────────────────────────────────────────────
def main():
    import argparse

    p = argparse.ArgumentParser(description="JSONL 诊断扫描器（格式无关）")
    p.add_argument("path", help="JSONL 文件路径")
    p.add_argument("--last-n", type=int, default=10, help="工具调用检查的最近 N 轮 (默认 10)")
    p.add_argument("--all", action="store_true", help="显示所有工具调用而非最近 N 轮")
    args = p.parse_args()

    path = Path(args.path)
    if not path.exists():
        print(f"❌ 文件不存在: {path}", file=sys.stderr)
        sys.exit(1)

    print(f"📂 加载: {path}")
    messages = []
    parse_errors = 0
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError as e:
                parse_errors += 1
                print(f"  ⚠️  行 {i} JSON 解析失败: {e}", file=sys.stderr)

    total = len(messages)
    print(f"  有效: {total} 条, 解析失败: {parse_errors} 行\n")

    # ── 报告 ──
    print("# JSONL 诊断扫描报告")
    print()
    print(f"| 项目 | 值 |")
    print(f"|------|----|")
    print(f"| 文件 | `{path}` |")
    print(f"| 总行数 | {total} |")
    print(f"| JSON 解析错误 | {parse_errors} |")

    # 角色/类型分布
    roles = Counter()
    types = Counter()
    for m in messages:
        r = _extract_role(m)
        t = _extract_type(m)
        roles[r] += 1
        types[t] += 1

    print()
    print("## 消息类型分布 (`type` 字段)")
    for t, c in types.most_common():
        print(f"- `{t}`: {c}")

    print()
    print("## 消息角色分布 (`role` 字段)")
    for r, c in roles.most_common():
        print(f"- `{r}`: {c}")

    # Check 1.1
    errors = check_errors(messages)
    print()
    print("## Check 1.1 — 异常关键词扫描")
    if errors:
        print(f"**发现 {len(errors)} 条**:")
        for e in errors[:30]:
            print(f"- `[{e['role']}]` {', '.join(e['hits'])} → {e['preview'][:120]}")
        if len(errors) > 30:
            print(f"  ... (共 {len(errors)} 条，仅显示前 30)")
    else:
        print("✅ 未命中异常关键词")

    # Check 1.9
    anomalies = check_stop_reason_consistency(messages)
    print()
    print("## Check 1.9 — stop_reason 与 content 一致性")
    if anomalies:
        print(f"⚠️  **{len(anomalies)} 处 stop_reason=tool_use 但 content 中无 tool_use 块:**")
        for a in anomalies:
            print(f"- 行 {a['line']}: content_types={a['content_types']}")
            if a["text_preview"]:
                print(f"  > {a['text_preview'][:120]}")
    else:
        print("✅ stop_reason 与 content 一致")

    # Check 1.10
    api_errors = check_api_error_markers(messages)
    print()
    print("## Check 1.10 — isApiErrorMessage 标记")
    if api_errors:
        print(f"⚠️  **{len(api_errors)} 条 isApiErrorMessage:**")
        for ae in api_errors:
            print(f"\n### 行 {ae['line']}")
            print(f"> {ae['error_text'][:200]}")
            if ae["preceding_assistants"]:
                print("前序 assistant:")
                for pa in ae["preceding_assistants"]:
                    print(f"  - 行 {pa['line']}: stop_reason=`{pa['stop_reason']}`, content={pa['content_types']}")
    else:
        print("✅ 无 isApiErrorMessage")

    # Check 1.2
    n = 0 if args.all else args.last_n
    tools = check_tool_calls(messages, n) if n > 0 else check_tool_calls(messages, len(messages))
    print()
    print(f"## Check 1.2 — 最近 {n if n else '全部'} 个工具调用")
    if tools:
        ok = sum(1 for t in tools if t["status"] == "OK" and not t["is_error"])
        no_res = sum(1 for t in tools if t["status"] == "NO_RESULT")
        err = sum(1 for t in tools if t["is_error"])
        for t in tools:
            icon = "❌" if t["is_error"] else ("⚠️" if t["status"] == "NO_RESULT" else "✅")
            print(f"- {icon} `{t['tool']}` — {t['status']}")
        print(f"\nOK={ok}, 无结果={no_res}, 含错误={err}, 合计={len(tools)}")
    else:
        print("（无工具调用）")

    # Check 1.3
    token_info = check_token_trend(messages)
    print()
    print("## Check 1.3 — Token 趋势")
    if token_info["count"]:
        print(f"| 指标 | 值 |")
        print(f"|------|----|")
        print(f"| 有 token 数据的请求 | {token_info['count']} |")
        print(f"| 首次 | {token_info['first']} |")
        print(f"| 末次 | {token_info['last']} |")
        print(f"| 峰值 | {token_info['max']} |")
        print(f"| 趋势 | {token_info['trend']} |")
    else:
        print("（JSONL 中无 token/usage 数据）")

    print()
    print("---")
    print(f"*脚本: scan_jsonl.py | 模式: 格式无关*")


if __name__ == "__main__":
    main()
