# csc serve 事件标准化 — 实施任务清单

> 关联文档：`docs/serve/serve-event-standardization-proposal.md`
> 原则：**不做双写**，csc serve 直接输出 canonical 格式，旧 cs-cloud passthrough 兼容

---

## Phase 1：sessionMessageRouter 路由增强

### 1.1 新建 StreamStateTracker

- [x] 创建 `src/server/streamStateTracker.ts`
- [x] 实现 `SessionStreamState` 状态结构（messageID、activeBlocks、usage、stopReason）
- [x] 实现 `processStreamEvent()` — Anthropic stream_event → canonical 事件转换
  - [x] `message_start` → `message.updated` + `step-start` part
  - [x] `content_block_start` (text) → `message.part.updated { type: "text" }`
  - [x] `content_block_start` (thinking) → `message.part.updated { type: "reasoning" }`
  - [x] `content_block_start` (redacted_thinking) → `message.part.updated { type: "reasoning", redacted: true }`
  - [x] `content_block_start` (tool_use) → `message.part.updated { type: "tool", status: "pending" }`
  - [x] `content_block_delta` (text_delta) → `message.part.delta { field: "text" }`
  - [x] `content_block_delta` (thinking_delta) → `message.part.delta { field: "text" }`
  - [x] `content_block_delta` (input_json_delta) → `message.part.delta { field: "input" }`
  - [x] `content_block_stop` (tool_use) → `message.part.updated { status: "running" }`
  - [x] `content_block_stop` (text/thinking) → finalize timing
  - [x] `message_delta` → 提取 usage.outputTokens + stopReason（不输出事件）
  - [x] `message_stop` → `message.part.updated { type: "step-finish" }` + reset state
- [x] 工具名规范化函数（`Bash` → `bash`、`Read` → `read` 等，复用现有 `toPermissionKey` 映射）
- [x] tool input JSON 累积 + try/catch 解析 fallback
- [x] 多 step（tool_use 循环）场景：每次 `message_start` 生成新 messageID

### 1.2 改造 stream_event 路由

- [x] `sessionMessageRouter.ts` — `case 'stream_event'` 改用 StreamStateTracker
- [x] 移除旧 `ctx.emitEvent('stream_event', msg)` — 不再做 raw 转发
- [x] Tracker 产出的 canonical 事件通过 `ctx.emitOpencodeEvent()` 发出

### 1.3 system 子类型分发

- [x] `case 'system'` — 替换当前的统一 `ctx.emitEvent('message', msg)`
- [x] `task_notification` → `ctx.emitOpencodeEvent('task.completed', { taskID, status, summary, usage, ... })`
- [x] `task_started` → `ctx.emitOpencodeEvent('task.started', { taskID, description, taskType, ... })`
- [x] `task_progress` → `ctx.emitOpencodeEvent('task.progress', { taskID, usage, summary, workflowProgress, ... })`
- [x] `api_error` / `api_retry` → `ctx.emitOpencodeEvent('session.error', { error: { subtype, message, retryInMs, ... } })`
- [x] `compact_boundary` / `microcompact_boundary` → `ctx.emitOpencodeEvent('message.part.updated', { part: { type: "compaction", auto, overflow } })`
- [x] `stop_hook_summary` → `ctx.emitOpencodeEvent('session.hook_summary', { ... })`
- [x] `turn_duration` → `ctx.emitOpencodeEvent('session.metrics', { ... })`
- [x] `cache_warning` → `ctx.emitOpencodeEvent('session.warning', { ... })`
- [x] `informational` → `ctx.emitOpencodeEvent('session.info', { ... })`
- [x] `post_turn_summary` → `ctx.emitOpencodeEvent('session.info', { ... })`
- [x] `session_state_changed` → `ctx.emitOpencodeEvent('session.status', { ... })`
- [x] `status` → `ctx.emitOpencodeEvent('session.status', { ... })`
- [x] `default` → `ctx.emitOpencodeEvent('session.info', { subtype, ...msg })`

### 1.4 新增 attachment 路由

- [x] `case 'attachment'` — 当前 default:break 丢弃
- [x] 转发为 `ctx.emitOpencodeEvent('message.attachment', { attachmentType, attachment })`
- [x] 关键 attachment 子类型至少覆盖：
  - [x] `hook_success` / `hook_error` / `hook_cancelled`
  - [x] `relevant_memories` / `nested_memory`
  - [x] `task_status` / `task_reminder`
  - [x] `diagnostics`
  - [x] `token_usage` / `budget_usd`
  - [x] `invoked_skills`

> 注：attachment 路由不区分子类型，统一通过 `attachmentType` 字段透传。消费端按需过滤。

### 1.5 新增 progress 路由

- [x] `case 'progress'` — 当前 default:break 丢弃
- [x] 转发为 `ctx.emitOpencodeEvent('tool.progress', { toolUseID, parentToolUseID, data })`

### 1.6 新增 tombstone 路由

- [x] `src/QueryEngine.ts` — serve 模式下将 tombstone 消息 yield 到 stdout
- [x] `sessionMessageRouter.ts` — `case 'tombstone'`
- [x] 转发为 `ctx.emitOpencodeEvent('message.removed', { messageID })`

### 1.7 handleResultMessage 增强

- [x] 提取 `stop_reason` 传播到 `session.result` 的 reason 字段
- [x] 提取 `usage` / `cost_usd` 透传到 `session.result` 事件
- [x] `subtype !== 'success'` 时发射 `session.error` 事件
- [x] 区分 result 子类型：`success` / `error_max_turns` / `error_max_budget` / `error_doom_loop` / `error`

### 1.8 handleAssistantMessage 增强（非流式 / 历史加载场景）

- [x] 完整 assistant 消息到达时，发射 `message.updated` 事件（含 role/modelID/cost/tokens/parentID）
- [x] 遍历 content blocks，为每个 block 发射 `message.part.updated`
  - [x] `text` block → text part
  - [x] `thinking` block → reasoning part
  - [x] `redacted_thinking` block → reasoning part (redacted)
  - [x] `tool_use` block → tool part (status: running)

---

## Phase 2：REST API 适配

### 2.1 消息历史端点标准化

- [x] `GET /session/{id}/message` — 返回 parts-based 格式（对标 opencode）
  - [x] assistant 消息：content blocks 分解为 parts 数组
  - [x] user 消息：text/tool_result 分解为 parts
  - [x] 新增 `format=parts` query parameter 消费端按需选择
  - [ ] system 消息：compaction_boundary → compaction part
  - [ ] attachment 消息：保留原始数据但增加 part 包装
- [ ] `GET /session/{id}/todo` — 适配响应格式

---

## Phase 3：EventBus / SSE 层调整

### 3.1 emitEvent → emitOpencodeEvent 统一

- [x] 审计 `sessionHandle.ts` 中所有 `ctx.emitEvent()` 调用
- [x] `emitEvent('message', ...)` → `emitOpencodeEvent('message.updated', ...)`
- [x] `emitEvent('result', ...)` → `emitOpencodeEvent('session.result', ...)`
- [x] `emitEvent('ready', ...)` → `emitOpencodeEvent('session.updated', ...)`
- [x] `emitEvent('deleted', ...)` → `emitOpencodeEvent('session.deleted', ...)`
- [x] `emitEvent('stream_event', ...)` → 移除（Phase 1.2 已由 StreamStateTracker 替代）
- [x] `emitEvent('control_request', ...)` → 保留（已有独立 opencode 事件）
- [x] `emitEvent('permission_replied', ...)` / `emitEvent('question_replied', ...)` → 保留（低级别确认）

### 3.2 SSE 事件名映射

- [x] 确认 `emitOpencodeEvent` 输出的 SSE event name 格式
- [x] 全部统一为 opencode 风格（无 `session.` 前缀）

---

## Phase 4：测试

### 4.1 单元测试

- [x] `src/server/__tests__/streamStateTracker.test.ts` (18 tests, 35 assertions)
  - [x] message_start → message.updated + step-start
  - [x] text content_block 完整流程 (start → delta → stop)
  - [x] thinking content_block 完整流程
  - [x] redacted_thinking 处理
  - [x] tool_use 完整流程 (start → input_delta → stop → running)
  - [x] message_delta 提取 usage/stopReason
  - [x] message_stop → step-finish + reset
  - [x] 多 step 场景（tool_use 循环产生多个 message_start/stop）
  - [x] input_json_delta 累积 + 损坏 JSON fallback
- [x] `src/server/__tests__/sessionMessageRouter.test.ts` (29 tests, 57 assertions)
  - [x] system.task_notification → task.completed
  - [x] system.task_started → task.started
  - [x] system.task_progress → task.progress
  - [x] system.api_error → session.error
  - [x] system.compact_boundary → compaction part
  - [x] attachment 路由
  - [x] progress 路由
  - [x] tombstone → message.removed
  - [x] result 子类型区分
  - [x] assistant 非流式消息 → parts 分解
  - [x] init → session.updated
  - [x] user → message.updated

### 4.2 集成测试

- [ ] 启动 csc serve，发送 prompt，验证 SSE 流包含完整 canonical 事件序列
- [ ] 后台 agent 场景：验证 task.started → task.progress → task.completed
- [ ] API 错误场景：验证 session.error 事件
- [ ] 压缩场景：验证 compaction part
- [ ] 历史消息加载：验证 parts-based 格式

### 4.3 兼容性测试

- [ ] 旧版 cs-cloud + 新 csc serve：确认旧 adapter 正常处理保留的事件名
- [ ] 旧版 cs-cloud passthrough 新事件：消费端不报错
- [ ] 新版 cs-cloud + 新 csc serve：确认 adapter 切换到新事件后功能不降级

---

## Phase 5：cs-cloud Adapter 精简（cs-cloud 侧）

### 5.1 切换到新事件源

- [ ] cs-cloud adapter 优先消费 `message.part.updated` / `message.part.delta` 而非 `session.stream_event`
- [ ] cs-cloud adapter 消费 `task.started` / `task.progress` / `task.completed` 而非从 `session.message` 推断
- [ ] cs-cloud adapter 消费 `session.error` 而非丢弃 system 子类型

### 5.2 移除适配代码

- [ ] 移除 `adapter_sse_stream.go`（StreamStateTracker 已在 csc 侧完成）
- [ ] 移除 `adapter_sse_message.go`（parts 分解已在 csc 侧完成）
- [ ] 移除 `adapter_parts.go`（part 构建已在 csc 侧完成）
- [ ] 保留 `adapter_json.go`（REST API 响应仍需适配，直到 Phase 2 完成）
- [ ] adapter 降级为 thin proxy（仅 SSE passthrough + REST 路由）

---

## 不在本次范围

- Event Sourcing / CQRS（架构变更过大）
- 多 Workspace 实例隔离（cs-cloud 多进程模型已解决）
- File snapshot / patch 追踪（依赖文件系统监控基础设施）
- Session fork / share 功能实现（需要 csc 核心逻辑支持）
