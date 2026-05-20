# 数据包结构规范

本文件定义 `cc-troubleshoot` 产出的数据包完整目录结构。

## 顶层结构

```
cc-debug-bundle-<timestamp>/
├── README.md                  # 人类可读摘要
├── manifest.json              # 所有文件的来源和处理记录
├── bundle-metadata.json       # 收集参数和过滤器记录
├── validation-report.json     # 校验报告
├── environment.json           # 环境信息
├── summary/                   # 摘要
│   ├── config-summary.json    # 配置摘要
│   └── timeline.md            # 会话时间线
├── config/                    # 配置（脱敏）
│   ├── settings-sanitized.json
│   └── settings-local-sanitized.json
├── session/                   # 会话数据（脱敏）
│   ├── transcript-sanitized.jsonl
│   ├── subagents-sanitized.jsonl
│   ├── tasks-sanitized.json
│   ├── <pid>.json              # 每个会话的完整状态文件
│   └── sessions-index.json     # 所有会话的关键字段汇总
├── errors/                    # 错误和诊断
│   ├── telemetry-failures-sanitized.jsonl
│   ├── debug-index.json
│   ├── debug/                  # debug 日志内容（脱敏，仅 --include-debug 时）
│   │   └── <session-id>.sanitized.txt
│   └── perf-summary.json
├── hooks/                     # Hook 信息
│   └── hook-summary.json
├── plugins/                   # 插件信息
│   └── plugins-list.json
├── env/                       # 环境快照（脱敏）
│   ├── session-env-sanitized.json
│   └── shell-snapshot-sanitized.txt
└── raw/                       # 原始文件（仅 --include-raw 时存在）
    ├── settings/              # 未脱敏配置文件
    ├── history/               # 全局历史
    ├── commands/              # 用户命令
    └── ...
```

## 文件说明

### README.md
- 收集时间、版本、范围参数
- 收集到的文件清单和大小
- 缺失/跳过的来源
- 隐私声明和安全提示

### manifest.json
```json
{
  "files": [
    {
      "path": "config/settings-sanitized.json",
      "source": "~/.claude/settings.json",
      "kind": "json",
      "sanitized": true,
      "sha256": "...",
      "bytes": 12345,
      "warnings": []
    }
  ],
  "missing_sources": [],
  "skipped_sources": []
}
```

### bundle-metadata.json
```json
{
  "schema_version": "1.0",
  "generated_at": "2026-05-13T12:00:00+08:00",
  "generator": {
    "skill": "cc-troubleshoot",
    "script": "collect_bundle.py"
  },
  "csc_version": "4.0.19",
  "filters": {},
  "symptom": "general",
  "redaction": {"enabled": true, "rules_version": "1.0"},
  "user_description": "",
  "warnings": []
}
```

### validation-report.json
校验结果，包含 `valid` 标志、问题清单（errors/warnings/info 分级）。

### environment.json
`collect_env.py` 的输出，包含 OS/CSC/Claude Code/Node/Shell/Terminal/Git 信息。

### summary/timeline.md
Markdown 格式的会话时间线，提取用户消息、工具调用、错误和状态变化。
