# csc serve 事件标准化整改提案

> 状态：提案 (2026-05-18)
> 范围：`src/server/sessionMessageRouter.ts`、`src/server/eventBus.ts`、`src/server/sessionHandle.ts`
> 依赖：cs-cloud `internal/agent/csc/adapter*.go`（Phase 3 可移除）

---

## 1. 问题概述

### 1.1 现状

`csc serve` 采用子进程模式（`--print --output-format stream-json`），子进程的 stdout 消息由 `sessionMessageRouter.ts` 路由为 SSE 事件。当前路由只处理 7 种消息类型：

| 类型 | 处理 | SSE 事件 |
|---|---|---|
| `assistant` | handleAssistantMessage | `session.message` |
| `user` | handleUserMessage | `session.message` |
| `result` | handleResultMessage | `session.result` |
| `control_request` | handleControlRequest | `session.control_request` |
| `control_cancel_request` | handleCancelRequest | (opencode events) |
| `stream_event` | 直接转发 | `session.stream_event` |
| `system` | 统一发出 | `session.message`（不区分子类型） |
| **其余所有** | **default: break** | **丢弃** |

### 1.2 丢弃的消息类型

以下消息类型到达 router 后被静默丢弃或信息不完整：

| 消息类型 | TUI 行为 | serve 现状 | 影响 |
|---|---|---|---|
| `attachment` (50+ 子类型) | 专用组件渲染 | **丢弃** | Hook 结果、记忆、任务状态、诊断等全部不可见 |
| `progress` | 关联到工具消息显示 | **丢弃** | Bash 实时输出、Agent 进度不可见 |
| `system.task_notification` | `UserAgentNotificationMessage` 渲染 | 统一为 `session.message` | 消费端无法识别任务完成事件 |
| `system.task_started` | 任务面板追踪 | 统一为 `session.message` | 后台任务启动不可见 |
| `system.task_progress` | 进度条 | 统一为 `session.message` | 实时进度不可见 |
| `system.api_error` | 错误+重试倒计时 | 统一为 `session.message` | API 错误/重试信息不可用 |
| `system.compact_boundary` | 压缩边界指示器 | 统一为 `session.message` | 上下文压缩不可追踪 |
| `system.stop_hook_summary` | Hook 汇总 | 统一为 `session.message` | Hook 执行结果不可见 |
| `tombstone` | 移除孤立消息 | **不到达 router** | 压缩后孤立消息永久残留 |
| `stream_event` 内容 | TUI 细粒度处理 | raw Anthropic 格式转发 | 需要 cs-cloud Go adapter 重度适配 |

### 1.3 cs-cloud 适配层的代价

cs-cloud 的 CSC adapter 有 ~800 行 Go 代码专门做格式转换：

| 文件 | 行数 | 功能 |
|---|---|---|
| `adapter_sse_stream.go` | ~300 | Anthropic stream_event → message.part.delta |
| `adapter_sse_message.go` | ~350 | CSC 消息 → parts 分解 |
| `adapter_parts.go` | ~200 | 工具/文本 part 构建 |
| `adapter_json.go` | ~300 | REST 响应适配 |

且 adapter 仍有大量遗漏：所有 `system` 子类型被丢弃、`tombstone` 不处理、`attachment` 不处理、`tool_progress` 信息不完整。

### 1.4 根本原因

**csc serve 输出的是「子进程协议格式」，不是「消费端协议格式」**。TUI 内部通过 `handleMessageFromStream()` 做了一层转换（stream event → React state），但 serve 模式缺少这层转换，将原始格式直接暴露给外部消费者。

---

## 2. 目标

1. **csc serve 原生输出 opencode 兼容的 canonical 事件格式**，消除 cs-cloud adapter 的适配需求
2. **补齐 task 生命周期事件**：`task.started` → `task.progress` → `task.completed`
3. **补齐 system 子类型事件**：api_error、compact_boundary、hook_summary 等
4. **补齐 attachment/progress 消息路由**
5. **保持向后兼容**：新旧事件格式并存过渡期

---

## 3. Canonical 事件格式规范

### 3.1 SSE 事件命名规范

对标 opencode serve 的事件总线，csc serve 应输出以下事件：

| 事件名 | 替代现有 | 数据结构 |
|---|---|---|
| `session.created` | 保留 | `{ session_id, status, created_at }` |
| `session.updated` | 新增（替代部分 session.ready） | `{ session_id, status, model, provider_id }` |
| `session.deleted` | 保留 | `{ session_id }` |
| `session.status` | 保留 | `{ sessionID, status: { type: "busy"/"idle" } }` |
| `session.diff` | 新增 | `{ sessionID, diff: FileDiff[] }` |
| `session.error` | 新增 | `{ sessionID, error }` |
| `message.updated` | 新增（替代 session.message） | `{ sessionID, info: MessageInfo }` |
| `message.part.updated` | 新增（替代 stream_event 部分） | `{ sessionID, part: Part }` |
| `message.part.delta` | 新增（替代 stream_event 部分） | `{ sessionID, messageID, partID, field, delta }` |
| `permission.asked` | 已有（opencode 事件） | 保留 |
| `permission.replied` | 已有 | 保留 |
| `question.asked` | 已有 | 保留 |
| `question.replied` | 已有 | 保留 |
| `task.started` | 新增 | 见 §3.3 |
| `task.progress` | 新增 | 见 §3.3 |
| `task.completed` | 新增 | 见 §3.3 |

### 3.2 Part 类型规范

每个消息由一个或多个 Part 组成：

```typescript
type Part =
  | { type: "text", id: string, text: string, time?: { start: number, end?: number } }
  | { type: "reasoning", id: string, text: string, time?: { start: number, end?: number } }
  | { type: "tool", id: string, callID: string, tool: string,
      state: { status: "pending", input: Record<string,any> }
            | { status: "running", input: Record<string,any>, title?: string, time: { start: number } }
            | { status: "completed", input: Record<string,any>, output: string, title: string, time: { start: number, end: number } }
            | { status: "error", input: Record<string,any>, error: string, time: { start: number, end: number } }
    }
  | { type: "step-start", id: string }
  | { type: "step-finish", id: string, reason: string, cost: number, tokens: { input: number, output: number, reasoning: number, cache: { read: number, write: number } } }
  | { type: "compaction", id: string, auto: boolean }
  | { type: "subtask", id: string, prompt: string, description: string, agent: string }
```

### 3.3 Task 生命周期事件

```typescript
// task.started
{
  sessionID: string,
  taskID: string,
  toolUseID?: string,
  description: string,
  taskType?: string,        // "local_agent" | "local_shell" | "local_workflow"
  workflowName?: string,
  prompt?: string,
}

// task.progress
{
  sessionID: string,
  taskID: string,
  description: string,
  usage: { total_tokens: number, tool_uses: number, duration_ms: number },
  lastToolName?: string,
  summary?: string,
  workflowProgress?: SdkWorkflowProgress[],
}

// task.completed
{
  sessionID: string,
  taskID: string,
  toolUseID?: string,
  status: "completed" | "failed" | "stopped",
  summary: string,
  outputFile: string,
  usage?: { total_tokens: number, tool_uses: number, duration_ms: number },
}
```

### 3.4 System 子类型事件映射

| system.subtype | canonical 事件 | 备注 |
|---|---|---|
| `task_notification` | `task.completed` | 终态通知 |
| `task_started` | `task.started` | 启动事件 |
| `task_progress` | `task.progress` | 进度事件 |
| `api_error` / `api_retry` | `session.error` + `message.part.updated { type: "retry" }` | 重试信息 |
| `compact_boundary` | `message.part.updated { type: "compaction" }` | 压缩边界 |
| `stop_hook_summary` | `session.hook_summary` | Hook 汇总 |
| `turn_duration` | `session.metrics` | Turn 耗时 |
| `cache_warning` | `session.warning` | 缓存警告 |
| `informational` | `session.info` | 一般信息 |

---

## 4. 改造方案

### 4.1 Phase 1：sessionMessageRouter 增强（P0）

#### 4.1.1 新增 StreamStateTracker

**文件**：`src/server/streamStateTracker.ts`（新建）

追踪每个 session 的流式状态，将 Anthropic 原始 stream_event 分解为 canonical parts 事件：

```typescript
interface StreamState {
  sessionID: string
  messageID: string
  parentID: string
  modelID: string
  activeBlocks: Map<number, {
    type: string           // "text" | "thinking" | "tool_use" | "redacted_thinking"
    partID: string
    toolUseID?: string
    toolName?: string
    inputJson: string      // 累积的 tool input JSON
  }>
  stepPartID: string       // step-start 的 part ID
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  stopReason: string
}
```

关键方法：

```typescript
class StreamStateTracker {
  // 处理 Anthropic stream_event，返回 canonical 事件数组
  processEvent(event: AnthropicStreamEvent, ctx: MessageRouterCtx): CanonicalEvent[]
}
```

处理逻辑：

| Anthropic 事件 | 输出 canonical 事件 |
|---|---|
| `message_start` | `message.updated` (assistant) + `message.part.updated { type: "step-start" }` |
| `content_block_start` (text) | `message.part.updated { type: "text" }` |
| `content_block_start` (thinking) | `message.part.updated { type: "reasoning" }` |
| `content_block_start` (tool_use) | `message.part.updated { type: "tool", status: "pending" }` |
| `content_block_start` (redacted_thinking) | `message.part.updated { type: "reasoning", redacted: true }` |
| `content_block_delta` (text_delta) | `message.part.delta { field: "text" }` |
| `content_block_delta` (thinking_delta) | `message.part.delta { field: "text" }` |
| `content_block_delta` (input_json_delta) | `message.part.delta { field: "input" }` |
| `content_block_stop` (tool_use) | `message.part.updated { type: "tool", status: "running" }` |
| `content_block_stop` (text/thinking) | _(finalize part timing)_ |
| `message_delta` | _(extract usage + stopReason, no event)_ |
| `message_stop` | `message.part.updated { type: "step-finish", cost, tokens, reason }` |

#### 4.1.2 改造 sessionMessageRouter.ts

**改动范围**：`src/server/sessionMessageRouter.ts`

##### a) stream_event case 改用 StreamStateTracker

```typescript
case 'stream_event': {
  ctx.setLastActiveAt(Date.now())
  const tracker = getOrCreateTracker(ctx.sessionId)
  const canonicalEvents = tracker.processEvent(msg.event, ctx)
  for (const event of canonicalEvents) {
    ctx.emitOpencodeEvent(event.type, event.properties)
  }
  // 保留原始 stream_event 向后兼容（过渡期后移除）
  ctx.emitEvent('stream_event', msg)
  break
}
```

##### b) system case 增加子类型分发

```typescript
case 'system': {
  const subtype = msg.subtype as string
  switch (subtype) {
    case 'task_notification':
      emitTaskCompleted(msg, ctx)
      break
    case 'task_started':
      emitTaskStarted(msg, ctx)
      break
    case 'task_progress':
      emitTaskProgress(msg, ctx)
      break
    case 'api_error':
    case 'api_retry':
      emitSessionError(msg, ctx)
      break
    case 'compact_boundary':
    case 'microcompact_boundary':
      emitCompactionEvent(msg, ctx)
      break
    case 'stop_hook_summary':
      emitHookSummary(msg, ctx)
      break
    default:
      break
  }
  // 向后兼容：同时发 session.message
  ctx.emitEvent('message', msg)
  break
}
```

##### c) 新增 attachment case

```typescript
case 'attachment': {
  ctx.emitOpencodeEvent('message.attachment', {
    sessionID: ctx.sessionId,
    attachmentType: (msg.attachment as Record<string, unknown>)?.type,
    attachment: msg.attachment,
  })
  // 不发 session.message（attachment 不是对话消息）
  break
}
```

##### d) 新增 progress case

```typescript
case 'progress': {
  const toolUseID = msg.toolUseID as string
  ctx.emitOpencodeEvent('tool.progress', {
    sessionID: ctx.sessionId,
    toolUseID,
    parentToolUseID: msg.parentToolUseID,
    data: msg.data,
  })
  break
}
```

##### e) handleResultMessage 增强

```typescript
function handleResultMessage(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  // ... 现有逻辑 ...

  const stopReason = msg.stop_reason as string | undefined
  const modelUsage = msg.modelUsage as Record<string, unknown> | undefined

  ctx.emitOpencodeEvent('session.status', {
    sessionID: ctx.sessionId,
    status: { type: 'idle' },
  })

  // 如果有 diff 信息，发射 session.diff
  // 如果有错误子类型，发射 session.error
  if (msg.subtype !== 'success') {
    ctx.emitOpencodeEvent('session.error', {
      sessionID: ctx.sessionId,
      error: {
        subtype: msg.subtype,
        is_error: msg.is_error,
        errors: msg.errors,
      },
    })
  }
}
```

#### 4.1.3 新增 tombstone 传递

**文件**：`src/QueryEngine.ts`

当前 tombstone 在 QueryEngine 中被拦截不转发。需要在 serve 模式下将其转发到 stdout：

```typescript
// QueryEngine.ts — yield 逻辑中
if (message.type === 'tombstone') {
  // 现有：skipped
  // 新增：在 serve 模式下转发
  if (getIsNonInteractiveSession()) {
    yield message as StdoutMessage
  }
  continue
}
```

**sessionMessageRouter.ts** 新增 case：

```typescript
case 'tombstone': {
  const targetUuid = (msg.message as { uuid: string })?.uuid
  if (targetUuid) {
    ctx.emitOpencodeEvent('message.removed', {
      sessionID: ctx.sessionId,
      messageID: targetUuid,
    })
  }
  break
}
```

### 4.2 Phase 2：assistant 消息 parts 分解（P1）

当收到完整的 `assistant` 消息（非流式，如历史加载），需要在 router 层将其 content blocks 分解为 parts：

```typescript
function handleAssistantMessage(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  // ... 现有逻辑 ...

  // 新增：发射 message.updated 事件
  ctx.emitOpencodeEvent('message.updated', {
    sessionID: ctx.sessionId,
    info: {
      id: msg.uuid,
      role: 'assistant',
      modelID: msg.model,
      providerID: msg.provider_id,
      cost: 0,  // 单条消息无独立 cost
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: msg.timestamp ? new Date(msg.timestamp as string).getTime() : Date.now() },
      parentID: msg.parentUuid ?? null,
    },
  })

  // 新增：分解 content blocks 为 parts
  const content = msg.message?.content as Array<Record<string, unknown>> ?? []
  for (const block of content) {
    const part = buildPartFromContentBlock(block, msg)
    if (part) {
      ctx.emitOpencodeEvent('message.part.updated', {
        sessionID: ctx.sessionId,
        part,
      })
    }
  }
}

function buildPartFromContentBlock(block: Record<string, unknown>, msg: StdoutMessage): Part | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', id: uuid(), text: block.text as string }
    case 'thinking':
      return { type: 'reasoning', id: uuid(), text: block.thinking as string }
    case 'redacted_thinking':
      return { type: 'reasoning', id: uuid(), text: '', redacted: true }
    case 'tool_use':
      return {
        type: 'tool', id: uuid(),
        callID: block.id as string,
        tool: normalizeToolName(block.name as string),
        state: {
          status: 'running',
          input: block.input as Record<string, unknown>,
          time: { start: Date.now() },
        },
      }
    default:
      return null
  }
}
```

### 4.3 Phase 3：向后兼容过渡（P1）

#### 4.3.1 双写期

在 Phase 1/2 实施后，新旧事件同时发出：

```
session.message (旧)     → 保留
message.updated (新)     → 新增
session.stream_event (旧) → 保留
message.part.delta (新)  → 新增
session.control_request (旧) → 保留
permission.asked (新)    → 已有
```

#### 4.3.2 cs-cloud 逐步切换

cs-cloud adapter 逐步切换到新事件：

1.  **v1**：adapter 优先消费新事件，旧事件作为 fallback
2.  **v2**：adapter 只消费新事件，移除 `adapter_sse_stream.go`、`adapter_sse_message.go`、`adapter_parts.go`
3.  **v3**：csc serve 移除旧事件输出，cs-cloud adapter 变为 thin proxy

#### 4.3.3 版本协商（可选）

SSE 连接可通过 `Accept-Event-Version: 2` header 选择新格式：

```typescript
// event route handler
const eventVersion = c.req.header('accept-event-version')
if (eventVersion === '2') {
  // 只发 canonical 事件
} else {
  // 双写
}
```

---

## 5. 新增事件处理函数

### 5.1 Task 生命周期

```typescript
// sessionMessageRouter.ts — 新增函数

function emitTaskStarted(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('task.started', {
    sessionID: ctx.sessionId,
    taskID: msg.task_id as string,
    toolUseID: msg.tool_use_id as string | undefined,
    description: msg.description as string,
    taskType: msg.task_type as string | undefined,
    workflowName: msg.workflow_name as string | undefined,
    prompt: msg.prompt as string | undefined,
  })
}

function emitTaskProgress(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('task.progress', {
    sessionID: ctx.sessionId,
    taskID: msg.task_id as string,
    description: msg.description as string,
    usage: msg.usage,
    lastToolName: msg.last_tool_name as string | undefined,
    summary: msg.summary as string | undefined,
    workflowProgress: msg.workflow_progress,
  })
}

function emitTaskCompleted(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('task.completed', {
    sessionID: ctx.sessionId,
    taskID: msg.task_id as string,
    toolUseID: msg.tool_use_id as string | undefined,
    status: msg.status as 'completed' | 'failed' | 'stopped',
    summary: msg.summary as string,
    outputFile: msg.output_file as string,
    usage: msg.usage,
  })
}
```

### 5.2 System 子类型

```typescript
function emitSessionError(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('session.error', {
    sessionID: ctx.sessionId,
    error: {
      subtype: msg.subtype,
      level: msg.level ?? 'error',
      message: msg.content ?? msg.error?.message,
      retryInMs: msg.retry_in_ms ?? msg.retryInMs,
      retryAttempt: msg.retry_attempt ?? msg.retryAttempt,
      maxRetries: msg.max_retries ?? msg.maxRetries,
    },
  })
}

function emitCompactionEvent(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('message.part.updated', {
    sessionID: ctx.sessionId,
    part: {
      type: 'compaction',
      id: msg.uuid ?? randomUUID(),
      auto: msg.subtype === 'microcompact_boundary' || (msg.compact_metadata as any)?.trigger === 'auto',
    },
  })
}

function emitHookSummary(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('session.hook_summary', {
    sessionID: ctx.sessionId,
    hookLabel: msg.hook_label ?? msg.hookLabel,
    hookCount: msg.hook_count ?? msg.hookCount,
    hookErrors: msg.hook_errors ?? msg.hookErrors,
    preventedContinuation: msg.prevented_continuation ?? msg.preventedContinuation,
    totalDurationMs: msg.total_duration_ms ?? msg.totalDurationMs,
  })
}
```

---

## 6. StreamStateTracker 详细设计

### 6.1 状态管理

```typescript
// src/server/streamStateTracker.ts

import { randomUUID } from 'crypto'

interface BlockState {
  type: string
  partID: string
  toolUseID?: string
  toolName?: string
  inputJson: string
  startTime: number
}

interface SessionStreamState {
  messageID: string
  parentID: string
  modelID: string
  activeBlocks: Map<number, BlockState>
  stepStartPartID: string
  assistantPartEmitted: boolean
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  stopReason: string
}

const states = new Map<string, SessionStreamState>()

function getOrCreate(sessionID: string): SessionStreamState {
  let state = states.get(sessionID)
  if (!state) {
    state = {
      messageID: randomUUID(),
      parentID: '',
      modelID: '',
      activeBlocks: new Map(),
      stepStartPartID: randomUUID(),
      assistantPartEmitted: false,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: '',
    }
    states.set(sessionID, state)
  }
  return state
}

function reset(sessionID: string): void {
  states.delete(sessionID)
}
```

### 6.2 事件处理

```typescript
type CanonicalEvent = {
  type: string
  properties: Record<string, unknown>
}

export function processStreamEvent(
  sessionID: string,
  event: Record<string, unknown>,
): CanonicalEvent[] {
  const results: CanonicalEvent[] = []
  const state = getOrCreate(sessionID)
  const eventType = event.type as string

  switch (eventType) {
    case 'message_start': {
      const msg = (event as any).message
      state.messageID = randomUUID()
      state.modelID = msg?.model ?? ''
      state.usage.inputTokens = msg?.usage?.input_tokens ?? 0
      state.usage.cacheReadTokens = msg?.usage?.cache_read_input_tokens ?? 0
      state.usage.cacheWriteTokens = msg?.usage?.cache_creation_input_tokens ?? 0

      if (!state.assistantPartEmitted) {
        results.push({
          type: 'message.updated',
          properties: {
            sessionID,
            info: {
              id: state.messageID,
              role: 'assistant',
              modelID: state.modelID,
              time: { created: Date.now() },
            },
          },
        })
        state.assistantPartEmitted = true
      }

      results.push({
        type: 'message.part.updated',
        properties: {
          sessionID,
          part: { type: 'step-start', id: state.stepStartPartID, sessionID, messageID: state.messageID },
        },
      })
      break
    }

    case 'content_block_start': {
      const block = (event as any).content_block
      const index = (event as any).index as number
      const partID = randomUUID()
      const blockState: BlockState = {
        type: block.type,
        partID,
        inputJson: '',
        startTime: Date.now(),
      }

      state.activeBlocks.set(index, blockState)

      if (block.type === 'text') {
        results.push({
          type: 'message.part.updated',
          properties: {
            sessionID,
            part: { type: 'text', id: partID, sessionID, messageID: state.messageID, text: '' },
          },
        })
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        results.push({
          type: 'message.part.updated',
          properties: {
            sessionID,
            part: {
              type: 'reasoning', id: partID, sessionID, messageID: state.messageID,
              text: '', redacted: block.type === 'redacted_thinking',
            },
          },
        })
      } else if (block.type === 'tool_use') {
        blockState.toolUseID = block.id
        blockState.toolName = block.name
        results.push({
          type: 'message.part.updated',
          properties: {
            sessionID,
            part: {
              type: 'tool', id: partID, sessionID, messageID: state.messageID,
              callID: block.id, tool: block.name,
              state: { status: 'pending', input: {}, raw: '' },
            },
          },
        })
      }
      break
    }

    case 'content_block_delta': {
      const index = (event as any).index as number
      const delta = (event as any).delta
      const blockState = state.activeBlocks.get(index)

      if (!blockState) break

      if (delta.type === 'text_delta') {
        results.push({
          type: 'message.part.delta',
          properties: { sessionID, messageID: state.messageID, partID: blockState.partID, field: 'text', delta: delta.text },
        })
      } else if (delta.type === 'thinking_delta') {
        results.push({
          type: 'message.part.delta',
          properties: { sessionID, messageID: state.messageID, partID: blockState.partID, field: 'text', delta: delta.thinking },
        })
      } else if (delta.type === 'input_json_delta') {
        blockState.inputJson += delta.partial_json
        results.push({
          type: 'message.part.delta',
          properties: { sessionID, messageID: state.messageID, partID: blockState.partID, field: 'input', delta: delta.partial_json },
        })
      }
      break
    }

    case 'content_block_stop': {
      const index = (event as any).index as number
      const blockState = state.activeBlocks.get(index)
      if (!blockState) break

      if (blockState.type === 'tool_use') {
        let parsedInput: Record<string, unknown> = {}
        try { parsedInput = JSON.parse(blockState.inputJson || '{}') } catch {}
        results.push({
          type: 'message.part.updated',
          properties: {
            sessionID,
            part: {
              type: 'tool', id: blockState.partID, sessionID, messageID: state.messageID,
              callID: blockState.toolUseID, tool: blockState.toolName,
              state: { status: 'running', input: parsedInput, time: { start: blockState.startTime } },
            },
          },
        })
      }
      break
    }

    case 'message_delta': {
      const delta = (event as any).delta
      const usage = (event as any).usage
      if (delta?.stop_reason) state.stopReason = delta.stop_reason
      if (usage?.output_tokens) state.usage.outputTokens = usage.output_tokens
      break
    }

    case 'message_stop': {
      results.push({
        type: 'message.part.updated',
        properties: {
          sessionID,
          part: {
            type: 'step-finish', id: randomUUID(), sessionID, messageID: state.messageID,
            reason: state.stopReason || 'stop',
            cost: 0,
            tokens: {
              input: state.usage.inputTokens,
              output: state.usage.outputTokens,
              reasoning: 0,
              cache: { read: state.usage.cacheReadTokens, write: state.usage.cacheWriteTokens },
            },
          },
        },
      })
      reset(sessionID)
      break
    }
  }

  return results
}
```

---

## 7. 测试计划

### 7.1 单元测试

| 测试文件 | 覆盖范围 |
|---|---|
| `src/server/__tests__/streamStateTracker.test.ts` | 所有 Anthropic stream event → canonical event 转换 |
| `src/server/__tests__/sessionMessageRouter.test.ts` | system 子类型分发、attachment/progress/tombstone 路由 |

### 7.2 集成测试

- 启动 csc serve，发送 prompt，验证 SSE 事件流包含：
  - `message.updated` + `message.part.updated` (text/reasoning/tool parts)
  - `message.part.delta` (流式 delta)
  - `task.started` / `task.completed`（后台 agent 场景）
  - `session.error`（API 错误场景）
  - `message.part.updated { type: "compaction" }`（压缩场景）

### 7.3 兼容性测试

- cs-cloud adapter 在双写期仍能正常工作（消费旧事件）
- cs-cloud adapter 切换到新事件后功能不降级

---

## 8. 实施计划

| Phase | 内容 | 预估工时 | 依赖 |
|---|---|---|---|
| Phase 1a | StreamStateTracker 实现 + stream_event 分解 | 3-4 天 | 无 |
| Phase 1b | system 子类型分发（task_*、api_error、compact_boundary） | 2 天 | 无 |
| Phase 1c | attachment / progress / tombstone 路由 | 1-2 天 | 无 |
| Phase 1d | handleResultMessage 增强 | 0.5 天 | 无 |
| Phase 2 | assistant 消息 parts 分解（历史加载场景） | 2 天 | Phase 1a |
| Phase 3a | cs-cloud adapter 优先消费新事件 | 3-4 天 | Phase 1+2 |
| Phase 3b | 移除 cs-cloud adapter 重度适配代码 | 1 天 | Phase 3a |
| Phase 3c | csc serve 移除旧事件（下个 major 版本） | 0.5 天 | Phase 3b |

---

## 9. 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| 双写期 SSE 事件量翻倍影响性能 | StreamStateTracker 产出的事件替代而非追加；旧事件可在 Phase 3 移除 |
| StreamStateTracker 状态泄漏 | message_stop 后 reset；session 关闭时清理 |
| 子进程协议变更影响非 serve 消费者 | 只改 sessionMessageRouter（serve 专属），不改子进程 stdout 协议 |
| tool input JSON 解析失败 | try/catch 包裹，fallback 为 `{}` |
| 多 step（tool_use 循环）中 messageID 管理错误 | 每次 message_start 生成新 messageID，step-finis/step-start 配对 |

---

## 10. 参考

- `src/server/sessionMessageRouter.ts` — 当前消息路由
- `src/server/eventBus.ts` — SSE 事件总线
- `src/server/sessionHandle.ts` — 子进程管理
- `src/utils/handleMessageFromStream()` — TUI 的流式事件处理（`src/utils/messages.ts:3262`）
- `packages/@ant/model-provider/src/types/message.ts` — 消息类型定义
- `src/utils/sdkEventQueue.ts` — SDK 事件队列（task_started/task_progress/task_notification）
- cs-cloud `internal/agent/csc/adapter_sse_stream.go` — Go 层流式适配（对标参考）
- cs-cloud `internal/agent/csc/adapter_sse_message.go` — Go 层消息适配（对标参考）
- opencode `packages/opencode/src/session/message-v2.ts` — canonical Part 类型定义
- opencode `packages/opencode/src/session/processor.ts` — 流式事件处理参考
