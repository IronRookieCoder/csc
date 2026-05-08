# csc serve — HTTP API 接口规范

> `csc serve` 启动一个 HTTP 服务器，为 IDE 插件和 Web 客户端提供 REST API。
> 内部架构为 **子进程模式**：每个会话 spawn 一个 `csc --print --input-format stream-json --output-format stream-json` 子进程，HTTP 层作为 NDJSON 协议的桥梁。

## 设计原则

1. **API 路径兼容 opencode serve**：cs-cloud 通过路由表映射，客户端无需感知后端差异
2. **子进程隔离**：1 session = 1 子进程，无进程内多会话
3. **子进程复用**：同一 session 的多次 prompt 复用同一子进程（bridge 模式已验证）
4. **JSONL 持久化**：会话数据沿用 csc 现有的 transcript JSONL 文件
5. **文件系统操作由 cs-cloud 自有接口处理**：`/api/v1/runtime/files` 等不经过 csc serve

## CLI 入口

```bash
csc serve [options]

Options:
  --port <port>        监听端口（默认 0 = 自动分配）
  --host <host>        监听地址（默认 127.0.0.1）
  --auth-token <token>  Bearer token 认证
  --workspace <dir>     默认工作目录
  --max-sessions <n>    最大并发会话数（默认 32）
  --idle-timeout <ms>   空闲会话超时（默认 1800000 = 30 分钟，0 = 永不超时）
```

stdout 输出端口信息（供 cs-cloud 解析）：

```
csc server listening on http://127.0.0.1:{port}
```

---

## API 端点总览

| 分类 | 端点数 | 说明 |
|---|---|---|
| Server | 1 | 健康检查 |
| Info | 5 | 路径、VCS、命令、agent 模式、MCP 状态 |
| Session | 11 | 会话 CRUD、prompt、abort |
| Event | 1 | SSE 事件流 |
| Permission | 2 | 权限请求列表、回复 |
| Question | 3 | 问题请求列表、回复、拒绝 |
| Message | 3 | 消息历史、todo、diff |
| Provider | 2 | 模型/Provider 信息 |
| **合计** | **28** | |

---

## 1. Server

### `GET /health`

服务健康检查。

**Response 200:**

```json
{
  "status": "ok",
  "version": "4.0.1",
  "uptime_ms": 12345,
  "active_sessions": 3
}
```

---

## 2. Info

### `GET /path`

获取路径信息。

**Response 200:**

```json
{
  "home": "/Users/user",
  "state": "/Users/user/.claude",
  "config": "/Users/user/.claude",
  "directory": "/path/to/workspace"
}
```

### `GET /vcs`

获取 VCS 信息。

**Response 200:**

```json
{
  "branch": "main"
}
```

### `GET /command`

列出可用 slash 命令。

**Response 200:**

```json
[
  { "name": "compact", "description": "Compact conversation" },
  { "name": "clear", "description": "Clear conversation" },
  { "name": "help", "description": "Show help" }
]
```

数据来源：子进程 `initialize` response 中的 `commands` 字段。

### `GET /agent`

列出可用的 agent 模式。

**Response 200:**

```json
[
  { "id": "main", "name": "Main Agent" },
  { "id": "plan", "name": "Plan Mode" }
]
```

数据来源：子进程 `initialize` response 中的 `agents` 字段。

### `GET /mcp`

获取 MCP 服务器状态。通过子进程 `mcp_status` control-request 获取。

**Response 200:**

```json
{
  "servers": [
    { "name": "filesystem", "status": "connected", "tools": 5 },
    { "name": "github", "status": "disconnected", "error": "Connection refused" }
  ]
}
```

---

## 3. Session

### `POST /session`

创建新会话。spawn 一个 `csc --print` 子进程。

**Request Body:**

```json
{
  "cwd": "/path/to/project",
  "permission_mode": "default",
  "model": "claude-sonnet-4-20250514",
  "system_prompt": "optional system prompt",
  "resume_session_id": "optional-uuid-to-resume"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cwd` | string | 否 | 工作目录，默认为 serve 的 `--workspace` |
| `permission_mode` | string | 否 | 权限模式：`default` / `bypassPermissions` / `plan` |
| `model` | string | 否 | 初始模型 |
| `system_prompt` | string | 否 | 自定义 system prompt |
| `resume_session_id` | string | 否 | 恢复已有会话的 ID |

**Response 201:**

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "starting",
  "cwd": "/path/to/project",
  "created_at": 1713001234567
}
```

子进程启动完成后通过 SSE 推送 `session.ready` 事件。

### `GET /session`

列出所有会话。

**Query Parameters:**

| 参数 | 类型 | 说明 |
|---|---|---|
| `limit` | number | 分页大小（默认 50） |
| `offset` | number | 分页偏移 |
| `search` | string | 搜索会话标题 |

**Response 200:**

```json
{
  "sessions": [
    {
      "session_id": "uuid-1",
      "status": "running",
      "cwd": "/path/to/project",
      "title": "Fix authentication bug",
      "model": "claude-sonnet-4-20250514",
      "permission_mode": "default",
      "created_at": 1713001234567,
      "last_active_at": 1713001299999,
      "cost_usd": 0.0523,
      "api_duration_ms": 12345
    }
  ]
}
```

数据来源：内存中的活跃会话 + `~/.claude/server-sessions.json` 持久化索引 + 各 session 的 transcript JSONL 头部。

### `GET /session/:sessionID`

获取单个会话详情。

**Response 200:**

```json
{
  "session_id": "uuid-1",
  "status": "running",
  "cwd": "/path/to/project",
  "title": "Fix authentication bug",
  "model": "claude-sonnet-4-20250514",
  "permission_mode": "default",
  "created_at": 1713001234567,
  "last_active_at": 1713001299999,
  "cost_usd": 0.0523,
  "api_duration_ms": 12345,
  "message_count": 12,
  "usage": {
    "input_tokens": 15000,
    "output_tokens": 5000,
    "cache_read_input_tokens": 10000,
    "cache_creation_input_tokens": 2000
  }
}
```

**Response 404:**

```json
{ "error": "session not found" }
```

### `PATCH /session/:sessionID`

更新会话属性。

**Request Body:**

```json
{
  "title": "New title",
  "model": "claude-sonnet-4-20250514",
  "permission_mode": "bypassPermissions"
}
```

`model` 和 `permission_mode` 的变更通过子进程的 control_request 实现（`set_model` / `set_permission_mode`）。

**Response 200:**

```json
{
  "session_id": "uuid-1",
  "title": "New title",
  "model": "claude-sonnet-4-20250514",
  "permission_mode": "bypassPermissions"
}
```

### `DELETE /session/:sessionID`

删除会话。kill 子进程 + 清理持久化索引。

**Response 200:**

```json
{ "deleted": true }
```

### `GET /session/status`

批量获取所有会话的状态。

**Response 200:**

```json
{
  "sessions": {
    "uuid-1": { "status": "running", "has_pending_permission": false },
    "uuid-2": { "status": "idle", "has_pending_permission": true }
  }
}
```

### `POST /session/:sessionID/prompt`

发送 prompt 并流式返回响应。对应子进程 stdin 写入 `SDKUserMessage`。

**Request Body:**

```json
{
  "content": "Fix the authentication bug in login.ts",
  "files": ["src/login.ts"],
  "images": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `content` | string | 是 | 用户输入内容 |
| `files` | string[] | 否 | 附带的文件路径（作为 context） |
| `images` | object[] | 否 | 图片附件（base64 或 URL） |

**Response 200 (streaming):**

Content-Type: `text/event-stream`

```
event: message
data: {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I'll fix the"}]}}

event: message
data: {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":" authentication bug."}]}}

event: message
data: {"type":"tool_progress","tool_name":"Edit","elapsed_time_seconds":1}

event: message
data: {"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_xxx","name":"Edit","input":{...}}]}}

event: result
data: {"type":"result","subtype":"success","cost_usd":0.0123,"duration_ms":5432,"usage":{"input_tokens":5000,"output_tokens":2000}}
```

事件类型直接映射子进程 stdout NDJSON 的 `SDKMessage.type`：

| NDJSON type | SSE event | 说明 |
|---|---|---|
| `assistant` | `message` | assistant 流式内容 |
| `partial_assistant` | `message` | 原始 API 流式事件 |
| `tool_progress` | `message` | 工具执行进度 |
| `result` | `result` | 最终结果（含 cost/usage） |
| `result_success` | `result` | 成功结果 |
| `system` | `system` | 系统消息（init、compact_boundary 等） |
| `status` | `system` | 状态变更 |
| `control_request` | `control_request` | 权限/交互请求 |
| `permission_denial` | `system` | 权限被拒绝 |

### `POST /session/:sessionID/prompt_async`

异步 prompt。立即返回，后台执行。通过 SSE 推送事件。

**Request Body:** 同 `prompt`。

**Response 204:** No Content

### `POST /session/:sessionID/abort`

中止当前正在执行的 prompt。向子进程发送 `control_request { subtype: "interrupt" }`，如果无响应则 SIGTERM。

**Response 200:**

```json
{ "aborted": true }
```

### `POST /session/:sessionID/shell`

在会话上下文中执行 shell 命令。转换为 prompt 发送到子进程。

**Request Body:**

```json
{
  "command": "npm test"
}
```

**Response 200 (streaming):** 同 `prompt` 的 SSE 流。

### `POST /session/:sessionID/command`

执行 slash 命令。转换为对应 prompt 发送到子进程。

**Request Body:**

```json
{
  "command": "/compact"
}
```

**Response 200 (streaming):** 同 `prompt` 的 SSE 流。

---

## 4. Event

### `GET /event`

全局 SSE 事件流。聚合所有会话的事件。

**Query Parameters:**

| 参数 | 类型 | 说明 |
|---|---|---|
| `session_id` | string | 可选，只订阅特定会话的事件 |

**Response 200 (SSE):**

```
event: connected
data: {"type":"server.connected"}

event: session.created
data: {"session_id":"uuid-1","status":"starting"}

event: session.ready
data: {"session_id":"uuid-1","status":"running","model":"claude-sonnet-4-20250514"}

event: session.message
data: {"session_id":"uuid-1","type":"assistant","message":{...}}

event: session.result
data: {"session_id":"uuid-1","type":"result","cost_usd":0.0123,"duration_ms":5432}

event: session.control_request
data: {"session_id":"uuid-1","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{...}}}

event: session.status_changed
data: {"session_id":"uuid-1","status":"idle"}

event: session.deleted
data: {"session_id":"uuid-1"}

event: heartbeat
data: {"type":"server.heartbeat","ts":1713001234567}
```

所有 session 相关事件都带 `session_id` 字段。心跳间隔 10 秒。

---

## 5. Permission

### `GET /permission`

列出所有待处理的权限请求。

**Response 200:**

```json
{
  "permissions": [
    {
      "request_id": "req-1",
      "session_id": "uuid-1",
      "tool_name": "Bash",
      "tool_use_id": "toolu_xxx",
      "input": { "command": "rm -rf node_modules" },
      "title": "Bash: rm -rf node_modules",
      "description": "Execute bash command"
    }
  ]
}
```

数据来源：拦截子进程 stdout 的 `control_request { subtype: "can_use_tool" }` 消息，缓存在内存。

### `POST /permission/:requestID/reply`

回复权限请求。向对应子进程 stdin 写入 `control_response`。

**Request Body (allow):**

```json
{
  "behavior": "allow",
  "updated_input": { "command": "rm -rf node_modules" }
}
```

**Request Body (deny):**

```json
{
  "behavior": "deny",
  "message": "Command not allowed"
}
```

**Response 200:**

```json
{ "resolved": true }
```

---

## 6. Question

csc 通过 `control_request { subtype: "elicitation" }` 实现 MCP elicitation 交互，映射为 question 端点。

### `GET /question`

列出所有待处理的问题请求。

**Response 200:**

```json
{
  "questions": [
    {
      "request_id": "req-2",
      "session_id": "uuid-1",
      "mcp_server_name": "my-server",
      "message": "Please provide your API key",
      "mode": "form",
      "requested_schema": { "type": "object", "properties": { "key": { "type": "string" } } }
    }
  ]
}
```

### `POST /question/:requestID/reply`

回复问题请求。

**Request Body:**

```json
{
  "action": "accept",
  "content": { "key": "sk-xxx" }
}
```

**Response 200:**

```json
{ "resolved": true }
```

### `POST /question/:requestID/reject`

拒绝问题请求。

**Request Body:**

```json
{
  "action": "decline"
}
```

**Response 200:**

```json
{ "resolved": true }
```

---

## 7. Message

### `GET /session/:sessionID/message`

获取会话消息历史。读取 transcript JSONL 文件。

**Query Parameters:**

| 参数 | 类型 | 说明 |
|---|---|---|
| `limit` | number | 返回条数（默认 50） |
| `before` | string | 游标：返回此 UUID 之前的消息 |
| `include_system` | boolean | 是否包含 system 消息（默认 false） |

**Response 200:**

```json
{
  "messages": [
    {
      "uuid": "msg-uuid-1",
      "type": "user",
      "role": "user",
      "content": "Fix the auth bug",
      "timestamp": 1713001234567,
      "parent_uuid": null
    },
    {
      "uuid": "msg-uuid-2",
      "type": "assistant",
      "role": "assistant",
      "content": [
        { "type": "text", "text": "I'll fix the authentication bug." },
        { "type": "tool_use", "id": "toolu_xxx", "name": "Edit", "input": { "file_path": "src/login.ts", "old_string": "...", "new_string": "..." } }
      ],
      "timestamp": 1713001234999,
      "parent_uuid": "msg-uuid-1",
      "usage": { "input_tokens": 5000, "output_tokens": 2000 }
    }
  ]
}
```

Headers:

```
Link: </session/uuid-1/message?before=msg-uuid-first>; rel="prev"
X-Next-Cursor: msg-uuid-first
```

实现方式：解析 `~/.claude/projects/<project>/sessions/<sessionID>.jsonl`，按 `parentUuid` 构建消息链。

### `GET /session/:sessionID/todo`

获取会话中的 todo/plan 列表。从 transcript 中提取 `tool_use[name=TodoWrite/TodoRead]` 消息。

**Response 200:**

```json
{
  "todos": [
    {
      "id": "todo-1",
      "content": "Fix authentication bug",
      "status": "in_progress",
      "priority": "high"
    },
    {
      "id": "todo-2",
      "content": "Add unit tests",
      "status": "pending",
      "priority": "medium"
    }
  ]
}
```

### `GET /session/:sessionID/diff`

获取会话中的文件变更。读取 csc 的 file-history 快照目录。

**Query Parameters:**

| 参数 | 类型 | 说明 |
|---|---|---|
| `messageID` | string | 可选，指定消息 ID 的变更 |

**Response 200:**

```json
{
  "diffs": [
    {
      "file": "src/login.ts",
      "status": "modified",
      "additions": 5,
      "deletions": 2,
      "patch": "--- a/src/login.ts\n+++ b/src/login.ts\n@@ -10,3 +10,6 @@..."
    }
  ]
}
```

注意：csc 的 file-history 没有索引，需要按 messageID 关联快照目录，实现复杂度中等。如果 messageID 未指定则返回全部变更。

---

## 8. Provider

### `GET /provider`

列出所有可用的 AI providers 和模型。

**Response 200:**

```json
{
  "connected": ["anthropic"],
  "default_model": "claude-sonnet-4-20250514",
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "connected": true,
      "models": [
        {
          "id": "claude-sonnet-4-20250514",
          "name": "Claude Sonnet 4",
          "context_window": 200000,
          "max_output_tokens": 64000,
          "supports_images": true,
          "supports_streaming": true
        }
      ]
    }
  ]
}
```

数据来源：
- 读取 `~/.claude/settings.json` 中的 API key 配置
- 通过子进程的 `initialize` response 中的 `models` 字段获取模型列表

### `GET /provider/capabilities`

精简的模型能力列表（供模型选择 UI 使用）。

**Response 200:**

```json
{
  "connected": [
    {
      "provider_id": "anthropic",
      "provider_name": "Anthropic",
      "models": [
        {
          "model_id": "claude-sonnet-4-20250514",
          "model_name": "Claude Sonnet 4",
          "context_window": 200000,
          "max_output_tokens": 64000,
          "supports_images": true,
          "input_cost_per_million": 3.0,
          "output_cost_per_million": 15.0
        }
      ]
    }
  ]
}
```

---

## 9. Find

### `GET /find/file`

按文件名搜索文件。

**Query Parameters:**

| 参数 | 类型 | 说明 |
|---|---|---|
| `query` | string | 搜索模式（必填） |
| `dirs` | string | 是否包含目录（"true" / "false"） |
| `limit` | number | 结果数量限制 |

**Response 200:**

```json
["src/login.ts", "src/logout.ts", "tests/login.test.ts"]
```

---

## 错误格式

所有错误响应使用统一格式：

```json
{
  "error": "ERROR_CODE",
  "message": "Human readable error message"
}
```

| HTTP Status | Code | 说明 |
|---|---|---|
| 400 | `BAD_REQUEST` | 请求参数错误 |
| 401 | `UNAUTHORIZED` | 认证失败（需要 auth-token） |
| 404 | `NOT_FOUND` | 会话/资源不存在 |
| 409 | `CONFLICT` | 会话已在执行中（重复 prompt） |
| 429 | `TOO_MANY_SESSIONS` | 超过 max-sessions 限制 |
| 500 | `INTERNAL` | 内部错误 |
| 503 | `SESSION_ERROR` | 子进程崩溃或无响应 |

---

## 认证

如果启动时指定了 `--auth-token`，所有请求需要携带：

```
Authorization: Bearer <token>
```

未携带或 token 不匹配返回 401。

---

## 子进程生命周期

```
POST /session
  → spawn: csc --print --input-format stream-json --output-format stream-json
           [--session-id <id>] [--resume <id>] [--permission-mode <mode>]
           [--model <model>]
  → 状态: starting

子进程输出 system.init
  → 状态: running

POST /session/:id/prompt
  → stdin: SDKUserMessage
  → stdout → SSE: assistant/result/control_request
  → 状态: running → active → idle

POST /session/:id/abort
  → stdin: control_request { subtype: "interrupt" }
  → 如果无响应: SIGTERM

idle-timeout 到期
  → SIGTERM 子进程
  → 状态: stopped

DELETE /session/:id
  → SIGKILL 子进程
  → 清理 SessionIndex
```

---

## cs-cloud 路由映射

cs-cloud 作为反向代理，将客户端 API 映射到 csc serve：

| cs-cloud 路由 | → csc serve 路由 | 客户端调用 |
|---|---|---|
| `POST /api/v1/conversations` | `POST /session` | `conversation.create` |
| `GET /api/v1/conversations` | `GET /session` | `conversation.list` |
| `GET /api/v1/conversations/{id}` | `GET /session/{id}` | `conversation.get` |
| `PATCH /api/v1/conversations/{id}` | `PATCH /session/{id}` | `conversation.update` |
| `DELETE /api/v1/conversations/{id}` | `DELETE /session/{id}` | `conversation.delete` |
| `POST /api/v1/conversations/{id}/prompt` | `POST /session/{id}/prompt` | `conversation.prompt` |
| `POST /api/v1/conversations/{id}/prompt/async` | `POST /session/{id}/prompt_async` | `conversation.promptAsync` |
| `POST /api/v1/conversations/{id}/abort` | `POST /session/{id}/abort` | `conversation.abort` |
| `GET /api/v1/conversations/{id}/messages` | `GET /session/{id}/message` | `conversation.messages` |
| `GET /api/v1/conversations/{id}/todo` | `GET /session/{id}/todo` | `conversation.todo` |
| `GET /api/v1/conversations/{id}/diff` | `GET /session/{id}/diff` | `conversation.diff` |
| `POST /api/v1/conversations/{id}/shell` | `POST /session/{id}/shell` | `conversation.shell` |
| `POST /api/v1/conversations/{id}/command` | `POST /session/{id}/command` | `conversation.command` |
| `GET /api/v1/conversations/status` | `GET /session/status` | `conversation.status` |
| `GET /api/v1/events` | `GET /event` | `event.stream` |
| `GET /api/v1/permissions` | `GET /permission` | `interaction.permissions` |
| `POST /api/v1/permissions/{id}/reply` | `POST /permission/{id}/reply` | `interaction.permissionRespond` |
| `GET /api/v1/questions` | `GET /question` | `interaction.questions` |
| `POST /api/v1/questions/{id}/reply` | `POST /question/{id}/reply` | `interaction.questionReply` |
| `POST /api/v1/questions/{id}/reject` | `POST /question/{id}/reject` | `interaction.questionReject` |
| `GET /api/v1/agents/models` | `GET /provider/capabilities` | `runtime.modelCapabilities` |
| `GET /api/v1/agents/session-modes` | `GET /agent` | `runtime.sessionModes` |
| `GET /api/v1/agents` | `GET /provider` | `runtime.agentRuntimes` |

以下 cs-cloud 路由不代理到 csc serve，由 cs-cloud 自有接口处理：

| cs-cloud 自有路由 | 客户端调用 | 说明 |
|---|---|---|
| `GET /api/v1/runtime/health` | `runtime.health` | cs-cloud 进程自身健康检查 |
| `GET /api/v1/runtime/files` | `runtime.fileList` | cs-cloud 直接读文件系统 |
| `GET /api/v1/runtime/files/content` | `runtime.fileRead` | cs-cloud 直接读文件内容 |

以下透传路由不经过 `/api/v1` 前缀，cs-cloud 直接代理：

| cs-cloud 透传路由 | → csc serve 路由 | 客户端调用 |
|---|---|---|
| `GET /path` | `GET /path` | `runtime.targetContext` |
| `GET /vcs` | `GET /vcs` | `runtime.vcs` |
| `GET /command` | `GET /command` | `runtime.commands` |
| `GET /mcp` | `GET /mcp` | `runtime.mcpStatus` |
| `GET /find/file` | `GET /find/file` | `runtime.findFiles` |
| `POST /instance/dispose` | `GET /health`（带 shutdown 标记） | `runtime.instanceDispose` |

---

## 与 opencode serve 的差异

| 能力 | opencode serve | csc serve | 说明 |
|---|---|---|---|
| 进程模型 | 1 进程多会话 | 1 进程 = 1 子进程 | csc 单例架构限制 |
| 会话存储 | SQLite 数据库 | JSONL 文件 + 内存索引 | csc 沿用现有 transcript |
| `POST /session/:id/revert` | ✅ | ❌ | csc 有 `rewind_files` control-request 可部分替代，但无完整 revert |
| `POST /session/:id/unrevert` | ✅ | ❌ | 同上 |
| `POST /session/:id/summarize` | ✅ | ❌ | csc 有 compact 但无独立 summarize |
| `POST /session/:id/fork` | ✅ | ❌ | 需 JSONL 文件复制 + UUID 重映射 |
| `POST /session/:id/share` | ✅ | ❌ | csc 无 share 功能 |
| `DELETE /session/:id/share` | ✅ | ❌ | 同上 |
| `GET /session/:id/diff` | ✅（DB 索引） | ⚠️（读 file-history） | 无索引，性能较差 |
| `GET /project` | ✅ | ❌ | csc 无项目数据库 |
| `GET /pty` | ✅ | ❌ | PTY 在子进程内部，无法外部操作 |
| `GET /tui/*` | ✅（14 个端点） | ❌ | 仅 TUI 模式有意义 |
| `GET /experimental/*` | ✅（11 个端点） | ❌ | 高级功能，暂不支持 |
| 文件操作 | csc serve 处理 | cs-cloud 自有接口 | `/api/v1/runtime/files` 不经过 csc |
