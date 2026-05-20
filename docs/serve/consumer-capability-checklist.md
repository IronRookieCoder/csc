# 新版消费端事件消费能力 Checklist

> 消费端指：app-ai-native、cs-cloud Web UI、VS Code 插件等通过 SSE/REST 消费 csc serve 的客户端
> 前提：csc serve 已完成事件标准化整改，输出 opencode canonical 格式
> 关联：`docs/serve/serve-event-standardization-proposal.md`、`docs/serve/serve-event-standardization-todo.md`
> 
> 状态标记说明：
> - ✅ app-ai-native 已实现
> - ❌ app-ai-native 未处理（需新增实现）
> - ⚠️ 部分实现 / 存在差距

---

## 1. SSE 事件消费

### 1.1 消息生命周期

| 事件 | 数据结构 | 消费端应实现 | app-ai-native |
|---|---|---|---|
| `message.updated` | `{ sessionID, info: { id, role, modelID, providerID, cost, tokens, time, parentID, finish, error } }` | 创建/更新消息对象 | ✅ `device-session.tsx` → `useMessageUpdater` |
| `message.part.updated` | `{ sessionID, part: Part }` | 创建/更新 part，渲染对应 UI | ✅ `device-session.tsx` → part dispatch by type |
| `message.part.delta` | `{ sessionID, messageID, partID, field, delta }` | 追加 delta 到指定 part 字段（流式渲染） | ✅ `device-session.tsx` → `handlePartDelta` |
| `message.removed` | `{ sessionID, messageID }` | 移除指定消息（tombstone 场景） | ❌ 无 switch case 处理 |
| `message.attachment` | `{ sessionID, attachmentType, attachment }` | 展示附加信息（hook 结果、记忆、诊断等） | ❌ 无 switch case 处理 |

### 1.2 Part 类型渲染

| Part 类型 | 渲染要求 | app-ai-native |
|---|---|---|
| `text` | 流式文本渲染（打字机效果），field `text` 的 delta 追加 | ✅ `createPacedValue` + Markdown 实时渲染 |
| `reasoning` | 可折叠的思考过程块，`redacted: true` 时显示「思考内容已隐藏」 | ✅ ReasoningPart 组件，默认折叠 |
| `tool` (pending) | 工具调用已开始，显示工具名 + 等待状态（spinner） | ✅ ToolPart 状态机 `pending` |
| `tool` (running) | 工具正在执行，显示工具名 + 输入参数摘要 + 运行中状态 | ✅ ToolPart 状态机 `running` |
| `tool` (completed) | 工具执行完成，显示标题 + 输出内容（可折叠） + 执行耗时 | ✅ ToolPart 状态机 `completed` |
| `tool` (error) | 工具执行失败，显示错误信息（红色标记） | ✅ ToolPart 状态机 `error` |
| `step-start` | 标记新一轮 LLM 调用开始（内部标记，不一定有独立 UI） | ✅ StepStartPart 组件 |
| `step-finish` | 标记一轮 LLM 调用结束，更新 step 级别的 cost/tokens/reason | ✅ StepFinishPart 组件 |
| `compaction` | 显示上下文压缩指示器（「对话已被压缩」） | ✅ CompactionPart 组件 |
| `subtask` | 显示子任务信息（prompt、agent、description） | ⚠️ 无独立 SubtaskPart 组件，可能以 tool part 显示 |

### 1.3 Task 生命周期

| 事件 | 消费端应实现 | app-ai-native |
|---|---|---|
| `task.started` | 在任务面板创建任务条目，显示 description、taskType | ❌ 无 `task.*` 事件处理；通过 `todo.updated` + ToolPart 状态推断 |
| `task.progress` | 更新任务进度：description 变更、usage 累积、workflow 进度条 | ❌ 同上 |
| `task.completed` | 标记任务终态（completed/failed/stopped），显示 summary + usage | ❌ 同上 |

> **注**: app-ai-native 目前通过 ToolPart (`tool === "task"`) 的状态转换 + `todo.updated` 来追踪任务进度，没有独立的 `task.*` 事件消费。新增 `task.*` 事件处理需要新建 TaskState Map 和相关 UI。

消费端应维护任务状态 Map：

```typescript
interface TaskState {
  taskID: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  description: string
  taskType?: string
  summary?: string
  usage?: { total_tokens: number, tool_uses: number, duration_ms: number }
  startTime: number
  endTime?: number
}
```

### 1.4 Session 状态

| 事件 | 消费端应实现 | app-ai-native |
|---|---|---|
| `session.created` | 创建 session 对象 | ✅ `device-workspace.tsx` → `session.created` handler |
| `session.updated` | 更新 session 元信息（model, provider, status） | ✅ `device-workspace.tsx` → `session.updated` handler |
| `session.deleted` | 移除 session 对象 | ✅ `device-workspace.tsx` → `session.deleted` handler |
| `session.status` | 更新 busy/idle 状态指示器（spinner 切换） | ✅ `device-session.tsx` → `session.status` handler |
| `session.error` | 显示错误 banner，含重试倒计时（retryInMs） | ❌ SDK 中有类型定义但 app-ai-native 无 switch case 处理 |
| `session.warning` | 显示警告 banner（cache_warning 等） | ❌ 无处理 |
| `session.info` | 显示信息提示（informational system 消息） | ❌ 无处理 |
| `session.metrics` | 更新性能指标面板（turn_duration, TTFT 等） | ❌ 无处理 |
| `session.hook_summary` | 显示 Hook 执行汇总 | ❌ 无处理 |
| `session.diff` | 更新文件变更预览 | ✅ `device-session.tsx` → `session.diff` handler |

### 1.5 权限与问答

| 事件 | 消费端应实现 | app-ai-native |
|---|---|---|
| `permission.asked` | 弹出权限确认对话框（工具名 + patterns + metadata） | ✅ `device-session.tsx` → `permission.asked` handler |
| `permission.replied` | 关闭对应权限对话框 | ✅ `device-session.tsx` → `permission.replied` handler |
| `question.asked` | 弹出问题对话框（header + options + multiple + custom） | ✅ `device-session.tsx` → `question.asked` handler |
| `question.replied` | 关闭对应问题对话框 | ✅ `device-session.tsx` → `question.replied` handler |
| `question.rejected` | 关闭对应问题对话框（取消状态） | ✅ `device-session.tsx` → `question.rejected` handler |

### 1.6 工具进度

| 事件 | 消费端应实现 | app-ai-native |
|---|---|---|
| `tool.progress` | 关联到对应 tool part，显示实时进度（Bash 输出、Agent 进度等） | ❌ 无 `tool.progress` 事件处理 |

### 1.7 基础设施事件

| 事件 | 消费端应实现 | app-ai-native |
|---|---|---|
| `server.connected` | SSE 连接建立，标记连接状态为 online | ⚠️ 通过 fetch 响应头判断连接状态，无独立事件 |
| `server.heartbeat` | 更新心跳时间戳，检测连接存活 | ⚠ SSE 注释行（`: heartbeat`）用作 keep-alive，无事件处理 |

---

## 2. REST API 消费

### 2.1 消息历史

| 端点 | 消费端应实现 | app-ai-native |
|---|---|---|
| `GET /session/{id}/message` | 加载消息历史，parts-based 格式解析 | ✅ `device-client.ts` → `session.message.list()` + parts 解析 |
| `GET /session/{id}/todo` | 加载 TODO 列表，结构化展示 | ✅ `todo.updated` 事件驱动 + SDK `todo` 类型 |
| `GET /session/{id}/diff` | 加载文件 diff，代码变更预览 | ✅ `session.diff` 事件 + diff 渲染组件 |

消息历史返回格式应为：

```typescript
interface MessageResponse {
  id: string
  role: 'user' | 'assistant'
  parts: Part[]
  time: { created: number, completed?: number }
  cost?: number
  tokens?: { input: number, output: number, reasoning: number, cache: { read: number, write: number } }
  modelID?: string
  providerID?: string
  parentID?: string
  finish?: string
  error?: { name: string, message: string }
}
```

### 2.2 Session 管理

| 端点 | 消费端应实现 | app-ai-native |
|---|---|---|
| `GET /session` | 列出所有 session，显示标题/时间/模型 | ✅ `device-client.ts` → `session.list()` |
| `POST /session` | 创建新 session | ✅ `device-client.ts` → `session.create()` |
| `GET /session/{id}` | 获取 session 详情 | ✅ `device-client.ts` → `session.get()` |
| `PATCH /session/{id}` | 更新 session（标题、tag 等） | ✅ `device-client.ts` → `session.update()` |
| `DELETE /session/{id}` | 删除 session | ✅ `device-client.ts` → `session.delete()` |
| `POST /session/{id}/prompt` | 发送 prompt | ✅ `device-client.ts` → `session.chat()` |
| `POST /session/{id}/abort` | 中止当前 turn | ✅ `device-client.ts` → `session.abort()` |
| `GET /session/status` | 获取所有 session 状态 | ✅ 通过 SSE `session.status` 事件 |

### 2.3 Provider / Model

| 端点 | 消费端应实现 | app-ai-native |
|---|---|---|
| `GET /provider/capabilities` | 获取可用模型列表及能力 | ⚠️ 通过 config/model API 获取，非标准端点 |

---

## 3. 流式渲染能力

### 3.1 文本流式渲染

- [x] ✅ 实现 `createPacedValue` 或等价的打字机效果
- [x] ✅ `message.part.delta { field: "text" }` → 追加到 text part 的 text 字段
- [x] ✅ 支持 Markdown 实时渲染（文本未完成时不关闭代码块等）

### 3.2 Reasoning 流式渲染

- [x] ✅ `message.part.delta { field: "text" }` → 追加到 reasoning part 的 text 字段
- [x] ✅ reasoning part 默认折叠，点击展开
- [x] ✅ `redacted: true` 时显示固定文案而非内容

### 3.3 Tool Input 流式渲染

- [x] ✅ `message.part.delta { field: "input" }` → 累积 tool input JSON
- [x] ✅ 实时解析部分 JSON 展示关键参数（如 file_path、command）

### 3.4 流式场景的滚动行为

- [x] ✅ 自动滚动到底部（用户未手动上翻时）
- [x] ✅ 用户上翻时暂停自动滚动，新消息提示后恢复

---

## 4. 工具状态机渲染

### 4.1 状态转换

```
pending → running → completed
                  → error
```

- [x] ✅ `pending`：显示工具名 + spinner + 输入参数预览
- [x] ✅ `running`：显示工具名 + 执行中标记 + 已运行时间
- [x] ✅ `completed`：显示标题 + 可折叠的输出内容 + 执行耗时 + cost
- [x] ✅ `error`：显示错误信息（红色）+ 可折叠的错误详情

### 4.2 特定工具的富渲染

| 工具 | 富渲染要求 | app-ai-native |
|---|---|---|
| `bash` / `powershell` | 命令行 + 输出（终端风格），tool.progress 实时追加输出 | ✅ BashToolRenderer（终端风格输出），❌ 无 `tool.progress` 实时追加 |
| `read` / `glob` / `grep` | 文件路径 + 匹配行数，可点击跳转 | ✅ ReadToolRenderer / GlobToolRenderer / GrepToolRenderer |
| `edit` / `fileedittool` | diff 预览（红色删除 / 绿色新增），含 filediff metadata | ✅ EditToolRenderer（diff 视图） |
| `write` | 新建文件标记 + 内容预览 | ✅ WriteToolRenderer |
| `agent` / `task` | 子任务进度指示器，关联 task.started/task.completed | ⚠️ ToolPart 状态机处理，无独立 task 事件关联 |
| `webfetch` / `websearch` | URL + 搜索结果摘要 | ✅ WebFetchToolRenderer |
| `ask_user_question` | 已由 question.asked 处理，tool part 显示为「等待用户回复」 | ✅ 由 question.asked 事件驱动 |

---

## 5. 任务面板

### 5.1 数据模型

```typescript
interface TaskPanelState {
  tasks: Map<string, TaskState>
  activeTaskCount: number
  totalCost: number
  totalTokens: number
}
```

### 5.2 UI 要求

- ❌ 任务列表视图（运行中 / 已完成分组）— 当前通过 `todo.updated` + ToolPart 间接展示
- ❌ 单任务详情展开（description、summary、usage）— 需新增
- ⚠️ 后台任务计数 badge — 通过 ToolPart `tool === "task"` 部分推断
- ❌ 任务完成通知（toast / desktop notification）— 需新增
- ❌ task.progress 的 workflow 进度条（phase 级别，如有的话）— 需新增

> **总结**: app-ai-native 没有独立的任务面板。任务进度通过 ToolPart 状态机 + `todo.updated` 间接追踪。如需富任务 UI，需要新增 `task.*` 事件消费 + TaskPanelState 管理。

---

## 6. 错误处理与重试

### 6.1 错误展示

| 场景 | 展示方式 | app-ai-native |
|---|---|---|
| `session.error` (api_error) | 红色 banner，含错误消息 + 重试倒计时 | ❌ SDK 有类型但无 UI 处理 |
| `session.error` (api_retry) | 黄色 banner，「正在重试 (N/M)...」 | ❌ 同上 |
| tool part (error) | 工具卡片内红色错误信息 | ✅ ToolPart error 状态渲染 |
| message.updated (error 字段) | 消息级别的错误标记 | ⚠️ 部分处理，依赖 message info 结构 |
| result (subtype: error_max_turns) | 「已达到最大轮次限制」提示 | ❌ 无独立处理 |
| result (subtype: error_max_budget) | 「已达到预算上限」提示 | ❌ 无独立处理 |

### 6.2 重试 UI

- ❌ 倒计时显示（来自 `session.error.retryInMs`）— 需新增
- ❌ 重试进度（`session.error.retryAttempt / maxRetries`）— 需新增

---

## 7. Cost / Token 追踪

### 7.1 数据来源

| 来源 | 字段 | 用途 |
|---|---|---|
| `step-finish` part | `cost`, `tokens.{input, output, reasoning, cache.read, cache.write}` | 每步成本 |
| `task.completed` | `usage.{total_tokens, tool_uses, duration_ms}` | 任务级成本 |
| `message.updated` | `info.cost`, `info.tokens` | 消息级成本 |
| `session.status` (idle) | 可触发 session 级汇总 | 会话总成本 |

### 7.2 UI 要求

- ⚠️ 会话级总成本显示（header / sidebar）— 部分实现，通过 message cost 累加
- ❌ 每步成本 tooltip（hover step-finish 区域）— 需新增
- ❌ 后台任务成本汇总 — 需新增
- ❌ Cache token 显示（read vs write）— 需新增

---

## 8. 向后兼容消费

### 8.1 旧事件兼容层（过渡期）

如果消费端仍需支持旧版 csc serve（未整改版本），应同时处理：

| 旧事件 | 处理方式 | app-ai-native |
|---|---|---|
| `session.message` (type: assistant) | 解析 content blocks，自建 parts | ❌ 不处理旧格式 |
| `session.message` (type: user) | 解析 content blocks | ❌ 不处理旧格式 |
| `session.stream_event` | 自行实现 stream → parts 转换（同旧 cs-cloud adapter） | ❌ 不处理旧格式 |
| `session.message` (type: system) | 检查 subtype 字段，按子类型分发 | ❌ 不处理旧格式 |
| `session.result` | 提取 cost/usage/subtype | ❌ 不处理旧格式 |
| `session.control_request` | 权限/问答处理 | ❌ 不处理旧格式 |

> **注**: app-ai-native 是全新实现，只消费 opencode canonical 格式，不兼容旧 `session.*` 前缀事件。旧版兼容由 cs-cloud adapter 层负责。

### 8.2 兼容判断

- ❌ SSE 连接后检查首条事件的格式（canonical vs legacy）— 不需要，仅支持 canonical
- ❌ 或通过 `GET /health` 的 `version` 字段判断 csc 版本 — 不需要
- ❌ canonical 模式下忽略旧事件，legacy 模式下走旧路径 — 不需要

---

## 9. 总结：app-ai-native 缺失项（需新增实现）

### 高优先级（核心体验影响）

| 缺失项 | 说明 | 建议实现位置 |
|---|---|---|
| `session.error` 处理 | API 错误、重试等无任何 UI 反馈 | `device-session.tsx` 新增 switch case |
| `message.removed` 处理 | tombstone 消息无法被移除 | `device-session.tsx` 新增 switch case |
| `tool.progress` 处理 | Bash 等工具无实时输出流 | `device-session.tsx` 新增 switch case + ToolPart 扩展 |

### 中优先级（增强体验）

| 缺失项 | 说明 | 建议实现位置 |
|---|---|---|
| `task.*` 事件消费 | 无独立任务面板/追踪 | 新建 `useTaskState` hook + TaskPanel 组件 |
| `session.warning` / `session.info` | 系统警告/信息无展示 | `device-session.tsx` 新增 switch case |
| `message.attachment` | hook 结果、记忆等附加信息无展示 | `device-session.tsx` 新增 switch case |
| Cost/Token 详细追踪 | 仅有消息级累加，无步骤级/缓存级展示 | 扩展 StepFinishPart 渲染 |

### 低优先级（锦上添花）

| 缺失项 | 说明 | 建议实现位置 |
|---|---|---|
| `session.metrics` | turn_duration/TTFT 性能面板 | 新建 MetricsPanel 组件 |
| `session.hook_summary` | Hook 执行汇总展示 | `device-session.tsx` 新增 switch case |
| Task 进度条 | workflow phase 级别进度 | TaskPanel 组件内 |
| 后台任务通知 | 任务完成 toast/desktop notification | 新建通知系统 |
| Cache token 展示 | cache read vs write 分离显示 | CostPanel 组件内 |
