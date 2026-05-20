# 数据源参考

Claude Code `~/.claude/` 下各目录的数据结构、排障价值和采集策略。

## 目录结构总览

```
~/.claude/
├── settings.json              # 全局配置
├── settings.local.json        # 本地覆盖配置（可选）
├── history.jsonl              # 全局查询历史（仅用户输入）
├── CLAUDE.md                  # 用户全局指令
├── sessions/                  # 会话元数据索引
│   └── <pid>.json
├── projects/                  # 项目级会话存储
│   └── -<sanitized-cwd>/
│       ├── <uuid>.jsonl       # 完整对话转录
│       └── <uuid>/            # 会话工件目录
│           ├── subagents/
│           │   ├── agent-<id>.jsonl
│           │   └── agent-<id>.meta.json
│           └── tool-results/
├── telemetry/
│   └── 1p_failed_events.<session-uuid>.<event-uuid>.json
├── debug/                     # 调试转储
├── session-env/
│   └── <uuid>/                # 会话环境变量
├── shell-snapshots/
│   └── snapshot-<shell>-<ms>-<random>.sh
├── plugins/
│   └── <name>/manifest.json
├── commands/
│   └── *.md
├── tasks/
│   └── <session-uuid>/
│       ├── .lock
│       └── <n>.json
├── perf-reports/
│   └── perf-<timestamp>-<name>.{json,md,csv}
├── backups/
│   └── settings.json.backup.<epoch>
├── cache/
│   ├── changelog.md
│   ├── gateway-models.json
│   └── my-closed-issues.json
├── file-history/
├── paste-cache/
├── issue-drafts/
└── statsig/
```

## 各源详情

### settings.json / settings.local.json

- **排障价值**: 高
- **敏感度**: 高（含 API key、token、env 变量）
- **默认策略**: 收集脱敏版到 `config/`
- **关键字段**:
  - `env` — 环境变量（含 API key）
  - `hooks` — 生命周期钩子配置
  - `permissions` — 工具权限白名单
  - `sandbox` — 沙盒配置
  - `model` — 模型选择
  - `statusLine` — 状态行配置
  - `plugins` — 插件配置

### sessions/<pid>.json

- **排障价值**: 中
- **敏感度**: 中
- **格式**: 单行 JSON
- **关键字段**: `pid`, `sessionId`, `cwd`, `startedAt`, `updatedAt`, `version`, `status`, `name`
- **默认策略**: 收集索引摘要到 `session/sessions-index.json`

### projects/-<cwd>/<uuid>.jsonl

- **排障价值**: 高
- **敏感度**: 高（对话内容含代码、密钥、个人信息）
- **格式**: 每行一个 JSON 对象
- **消息类型**: `user`, `assistant`, `system`, `file-history-snapshot`
- **默认策略**: 按会话、时间、轮数裁剪后脱敏

### telemetry/1p_failed_events.*.json

- **排障价值**: 高
- **敏感度**: 中
- **格式**: JSON 对象（单文件单事件）
- **命名**: `1p_failed_events.<session-uuid>.<event-uuid>.json`
- **默认策略**: 按时间和 session 过滤后脱敏

### plugins/

- **排障价值**: 中
- **敏感度**: 中
- **默认策略**: 收集插件名、版本、启用状态、manifest 摘要

### shell-snapshots/

- **排障价值**: 中
- **敏感度**: 高（含 alias、function 定义、环境变量）
- **默认策略**: 收集最近一个快照的脱敏版

### session-env/<uuid>/

- **排障价值**: 中
- **敏感度**: 高（含完整环境变量值）
- **默认策略**: 收集会话环境变量的脱敏摘要

### debug/<session-id>.txt

- **排障价值**: 高（API 请求/响应、MCP 通信、Hook 执行详情）
- **敏感度**: 高（含 API key、token、完整 request/response body）
- **路径**: `~/.claude/debug/<session-id>.txt`
- **格式**: 纯文本，由 `claude --debug "api,mcp,hooks"` 等分类过滤生成
- **关键内容**:
  - API 请求/响应 headers 和 body（含 model、temperature、max_tokens）
  - MCP server stderr/stdout（连接、工具列表、调用详情）
  - Hook matcher 评估和执行日志（触发条件、stdout/stderr、exit code）
  - 文件操作日志（Read/Write/Edit 的路径和内容摘要）
  - 权限决策日志（allow/deny 的判定依据）
  - 统计和遥测日志（statsig、telemetry）
- **默认策略**: 默认仅收集文件列表索引（`errors/debug-index.json`）；`--include-debug` 时收集脱敏后的完整内容到 `errors/debug/`
