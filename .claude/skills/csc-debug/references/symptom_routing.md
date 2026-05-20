# 症状路由表

本文档定义用户问题现象到诊断入口层和优先数据源的映射。

## 症状分类

| 症状值 | 中文关键词 | 英文关键词 | 说明 |
|--------|-----------|-----------|------|
| `hang` | 卡住、无响应、不动、没反应、死锁 | hang, stuck, freeze, unresponsive, deadlock | 会话或任务卡住不响应 |
| `hook_failure` | Hook报错、Hook失败、钩子报错 | hook error, hook failure, StopFailure | Hook 执行失败 |
| `permission` | 权限、沙盒、拒绝、不允许 | permission, sandbox, denied, blocked | 权限/沙盒异常 |
| `api_error` | 模型调用失败、API报错、限流、超时 | API error, rate limit, timeout, 429, 500 | 模型 API 调用错误 |
| `session_lost` | 会话丢失、历史没了、不见了 | session lost, history gone, missing session | 会话/对话历史丢失 |
| `startup_crash` | 启动失败、打不开、闪退、崩溃 | crash, startup, launch fail, won't start | CSC 无法启动 |
| `plugin` | 插件报错、MCP失败、扩展问题 | plugin error, MCP failure, extension | 插件/MCP 问题 |
| `tool_error` | 工具调用失败、bash报错、命令执行失败 | tool error, bash error, command failed | 工具调用异常 |
| `general` | 不知道什么问题、帮我看看 | troubleshoot, general, diagnose | 一般排查 |

## 症状 → 推荐排查路线

每种症状按「最容易命中 → 最深层次」排序：

| 症状 | 推荐起始层 | 推荐层序遍历 | 可跳过层 |
|------|-----------|-------------|---------|
| `hang` | Layer 1 | 1 → 2 → 2.5 → 3 → 5 | 7, 8, 9 (除非网络确认异常) |
| `hook_failure` | Layer 1 | 1 → 4 → 2.5 → 2 | 3, 5-10 (除非基础层排除) |
| `permission` | Layer 2.5 | 2.5 → 1 → 2 | 3-10 (除非指向更深原因) |
| `api_error` | Layer 2 | 2 → 5 → 6 → 7 | 3, 4 (除非 MCP/Hooks 报错) |
| `session_lost` | Layer 1 | 1 → 2.5 | 2-10 (通常不需要) |
| `startup_crash` | Layer 2 | 2 → 1 → 2.5 → 6 | 7-10 (通常不需要) |
| `plugin` | Layer 2.5 | 2.5 → 3 → 2 | 4-10 (除非基础层排除) |
| `tool_error` | Layer 1 | 1 → 2 → 2.5 → 3 → 4 | 7-10 (通常不需要) |
| `general` | Layer 2.5 | 2.5 → 1 → 2 → 3 → 4 → 5 → ... | 按需 |

## 每种症状的初始假设 Top 3

### hang
1. 工具调用卡在某个异步操作上，未返回 tool_result
2. subagent 死循环或 token 耗尽
3. MCP server 无响应导致工具调用阻塞

### hook_failure
1. matcher 写错（大小写、工具名拼写）
2. hook command 路径不可执行或权限不足
3. hook stdout 污染了 JSON 输出

### permission
1. permissions 配置中的规则被更宽泛的规则覆盖
2. sandbox 配置阻止了合法操作
3. 权限模式设置不正确（如 expectAcceptEdits 但实际是 default）

### api_error
1. API Key 无效或过期（401）
2. 限流（429）
3. 代理/VPN 导致连接失败

### session_lost
1. cwd 路径变化导致 session 映射失败（路径编码问题）
2. session JSONL 文件被手动删除或移动
3. 启动时加载了错误的项目目录

### startup_crash
1. settings.json 语法错误或 schema 不兼容
2. Node/Bun 版本不兼容
3. 本地安装损坏（npm 和 native 冲突）

### plugin
1. MCP server command 路径错误
2. MCP server 启动了但 tools 为 0
3. MCP 未 approval

### tool_error
1. Bash 命令在 sandbox 中被拦截
2. API 兼容层导致模型响应格式异常（如 `stop_reason=tool_use` 但 content 无 `tool_use` 块）
3. 工具调用参数格式错误
4. 文件路径权限不足

## 每种症状的关键数据源（按优先级）

### hang
1. JSONL — 最后 10 轮工具调用的 tool_use / tool_result 配对
2. JSONL — subagent 转录
3. session-env — 会话环境变量

### hook_failure
1. settings.json — hooks 配置段
2. JSONL — hook 相关错误消息
3. debug log — hooks 分类输出

### permission
1. /permissions 输出
2. settings.json — permissions / sandbox 段
3. JSONL — 权限拒绝的工具调用记录

### api_error
1. debug log — api 分类输出
2. settings.json — env / model 段
3. telemetry 失败事件

### session_lost
1. `~/.claude/projects/` 目录列表
2. sessions-index.json
3. history.jsonl

### startup_crash
1. settings.json + settings.local.json
2. debug log — ERROR/FATAL 级别
3. environment.json — OS/Node/CSC 版本

### plugin
1. /mcp 输出
2. settings.json — MCP/plugin 配置段
3. .mcp.json 内容

### tool_error
1. JSONL — ToolUse 失败记录（含 exit code / stderr / isApiErrorMessage）
2. JSONL — `stop_reason` 与 content 中 tool_use 块的一致性检查
3. API 请求/响应快照（如 `json/*.json`）— 排查模型响应格式问题
4. 同场景下成功案例的 JSONL（对比分析用）
5. settings.json — permissions / sandbox 段
6. debug log — tool 相关分类
