# 故障数据包结构说明

本文档说明 CSC 故障数据包的标准结构，供本 Skill 在 Phase 1 读取数据包时参照。

## 标准 bundle 结构（cc-troubleshoot 产出格式）

```
cc-debug-bundle-<timestamp>/
├── README.md                      # 收集摘要（时间、版本、范围、文件清单）
├── manifest.json                  # 所有文件的来源、脱敏状态和校验信息
├── bundle-metadata.json           # 收集参数、过滤器、脱敏规则版本
├── validation-report.json         # 数据包校验报告（valid 标志 + error/warning/info）
├── environment.json               # OS/CSC/Node/Shell/Terminal/Git 版本信息
├── summary/
│   └── timeline.md                # 会话事件时间线（Markdown）
├── config/
│   ├── settings-sanitized.json    # 脱敏后的主配置
│   └── settings-local-sanitized.json
├── session/
│   ├── transcript-sanitized.jsonl # 脱敏后的会话转录
│   ├── subagents-sanitized.jsonl  # 脱敏后的子 agent 转录
│   ├── tasks-sanitized.json       # task 状态
│   ├── <pid>.json                 # 会话状态文件
│   └── sessions-index.json        # 所有会话的关键字段摘要
├── errors/
│   ├── telemetry-failures-sanitized.jsonl  # 脱敏后的 telemetry 失败事件
│   ├── debug-index.json           # debug/ 目录文件列表
│   └── perf-summary.json          # 最近 10 条性能报告摘要
├── hooks/
│   └── hook-summary.json          # 从 settings 提取的 hooks 配置
├── plugins/
│   └── plugins-list.json          # 已安装插件清单
├── env/
│   ├── session-env-sanitized.json # 会话级环境变量快照
│   └── shell-snapshot-sanitized.txt # 最近 shell 环境快照
└── raw/                           # 原始未脱敏文件（仅 --include-raw 时存在）
```

## 本 Skill 如何使用 bundle 数据

### Phase 1 数据加载优先级

1. **`session/transcript-sanitized.jsonl`** — 最重要，Layer 1 诊断的核心数据源
2. **`summary/timeline.md`** — 快速了解故障前后发生的事件序列
3. **`environment.json`** — 确认环境版本信息，消除环境因素
4. **`config/settings-sanitized.json`** — 检查配置问题（Layer 2.5）
5. **`errors/telemetry-failures-sanitized.jsonl`** — 查找已知的失败事件
6. **`errors/debug-index.json`** — 确认是否有 debug 日志可用（Layer 2）
7. **`hooks/hook-summary.json`** — Hook 相关症状时优先（Layer 4）
8. **`env/session-env-sanitized.json`** — 环境变量相关症状时优先

### 直接读取 ~/.claude/ 目录

如果开发人员没有 bundle，而是直接指定 `~/.claude/` 下的路径：

| 需求 | 路径 |
|------|------|
| 主配置 | `~/.claude/settings.json` |
| 本地覆盖配置 | `~/.claude/settings.local.json` |
| 会话 JSONL | `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` |
| Debug 日志 | `~/.claude/debug/<sessionId>.txt` |
| 会话状态 | `~/.claude/sessions/<pid>.json` |
| 全局历史 | `~/.claude/history.jsonl` |
| Telemetry 失败 | `~/.claude/telemetry/1p_failed_events.*.json` |
| Session 环境变量 | `~/.claude/session-env/<uuid>/` |

### 数据完整性验证

Phase 1 加载数据后应检查：
1. JSONL 文件存在且非空
2. JSONL 文件每行都是有效 JSON
3. settings.json 存在且可解析
4. 如果 bundle 有 validation-report.json，检查 errors 字段

### 数据不足时的处理

- 缺少 JSONL → 提示"无法进行 Layer 1 分析"，建议跳过 Layer 1
- 缺少 settings → 无法检查配置问题（Layer 2.5 部分受限）
- 缺少 debug log → 建议用户开启 --debug 复现问题后重试
- 缺少环境信息 → 仍然可以分析，但无法排除环境因素
