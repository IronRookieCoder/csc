# 症状路由参考

本文档定义用户问题意图到数据源的映射规则，供 `SKILL.md` 和 `collect_bundle.py` 参照。

## 症状分类

| 症状值 | 中文关键词 | 英文关键词 | 说明 |
|--------|-----------|-----------|------|
| `hang` | 卡住、无响应、不动、没反应、死锁 | hang, stuck, freeze, unresponsive, deadlock | 会话或任务卡住不响应 |
| `hook_failure` | Hook报错、Hook失败、钩子报错 | hook error, hook failure, StopFailure, PreToolUse error | Hook 执行失败 |
| `permission` | 权限、沙盒、拒绝、不允许 | permission, sandbox, denied, blocked | 权限/沙盒异常 |
| `api_error` | 模型调用失败、API报错、限流、超时 | API error, rate limit, timeout, 401, 403, 429, 500, model error | 模型 API 调用错误 |
| `session_lost` | 会话丢失、历史没了、不见了 | session lost, history gone, missing session | 会话/对话历史丢失 |
| `startup_crash` | 启动失败、打不开、闪退、崩溃 | crash, startup, launch fail, won't start | Claude Code 无法启动 |
| `plugin` | 插件报错、MCP失败、扩展问题 | plugin error, MCP failure, extension | 插件/MCP 问题 |
| `tool_error` | 工具调用失败、bash报错、命令执行失败 | tool error, bash error, command failed, ToolUse error | 工具调用异常 |
| `general` | 未指定/一般排查 | general, troubleshoot | 全量收集，不调整优先级 |

## 症状 → 参数调整

| 症状 | 调整 default_rounds | 额外 --include 标志 | 时间窗调整 |
|------|-------------------|---------------------|-----------|
| `hang` | 10 | — | 默认 |
| `hook_failure` | 30 | `--include-debug` | 扩展 2x（48h） |
| `permission` | 20 | — | 默认 |
| `api_error` | 15 | `--include-debug` | 默认 |
| `session_lost` | 30 | `--include-history` | 扩展 4x（7d） |
| `startup_crash` | 5 | `--include-debug` | 扩展 2x（48h） |
| `plugin` | 20 | `--include-debug` | 默认 |
| `tool_error` | 25 | `--include-debug` | 默认 |
| `general` | 0（全量） | — | 默认（24h） |

## 优先数据源

每个症状下的收集优先级（高→低）：

### hang
1. `projects/<proj>/<uuid>.jsonl` 最后 10 轮
2. `sessions/<pid>.json` 当前会话状态
3. `tasks/<uuid>/*.json` 任务状态文件
4. `telemetry/` 失败事件

### hook_failure
1. `settings.json` hooks 段
2. `debug/` debug 日志
3. `shell-snapshots/` 最近一个
4. `projects/<proj>/<uuid>.jsonl` 最近 30 轮
5. `session-env/<uuid>/` 会话环境

### permission
1. `settings.json` permissions 段
2. `settings.json` sandbox 段
3. `projects/<proj>/<uuid>.jsonl` 最近 20 轮

### api_error
1. `telemetry/` 失败事件
2. `debug/` debug 日志
3. `settings.json` env/model 段
4. `cache/gateway-models.json`
5. `projects/<proj>/<uuid>.jsonl` 最近 15 轮

### session_lost
1. `sessions/*.json` 全量索引
2. `projects/` 下所有 JSONL 列表及 mtime
3. `history.jsonl`（需显式开启）

### startup_crash
1. `settings.json`
2. `settings.local.json`
3. `debug/`
4. `cache/`
5. `shell-snapshots/` 最近一个

### plugin
1. `plugins/` 目录及 manifest
2. `debug/` debug 日志（MCP 通信）
3. `settings.json` MCP/plugin 配置段
4. `telemetry/` 失败事件

### tool_error
1. `projects/<proj>/<uuid>.jsonl` 聚焦 ToolUse 错误消息
2. `debug/` debug 日志
3. `telemetry/` 失败事件
4. `settings.json` permissions/sandbox 段
