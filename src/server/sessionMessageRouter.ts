import { randomUUID } from 'crypto'
import { jsonStringify } from '../utils/slowOperations.js'
import { processStreamEvent, hasActiveStream, consumeStreamedTurn, getCompletedToolInfo, registerAgentSession } from './streamStateTracker.js'
import type { ControlChannel } from './sessionControlChannel.js'
import type { SessionBusyStatus, SessionState, InitData, PendingPermission, PendingQuestion } from './types.js'
import type { SessionMessage } from './transcriptReader.js'

const API_ERROR_PREFIX_RE = /^API Error:\s*/
const COSTRICT_API_ERROR_PREFIX_RE = /^CoStrict API Error:\s*/

type SubagentToolState = {
  emittedToolCount: number
  assistantMessageID: string
  toolPartIDs: Map<number, string>
  mainPartID: string
  mainMessageID: string
  mainToolUseID: string
  progressLines: string[]
}

const subagentToolState = new Map<string, SubagentToolState>()

function isApiErrorContent(content: unknown): boolean {
  if (typeof content === 'string') {
    return API_ERROR_PREFIX_RE.test(content) || COSTRICT_API_ERROR_PREFIX_RE.test(content)
  }
  if (!Array.isArray(content)) return false
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      const text = b.text as string
      if (API_ERROR_PREFIX_RE.test(text) || COSTRICT_API_ERROR_PREFIX_RE.test(text)) return true
    }
  }
  return false
}

function buildErrorFromContent(content: unknown): { name: string; data: { message: string; statusCode?: number; isRetryable?: boolean } } {
  let raw = ''
  if (typeof content === 'string') {
    raw = content.replace(API_ERROR_PREFIX_RE, '').replace(COSTRICT_API_ERROR_PREFIX_RE, '')
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') {
        raw = (b.text as string).replace(API_ERROR_PREFIX_RE, '').replace(COSTRICT_API_ERROR_PREFIX_RE, '')
        break
      }
    }
  }
  const statusMatch = raw.match(/^(\d{3})\s+/)
  const statusCode = statusMatch ? parseInt(statusMatch[1]!, 10) : undefined
  const isRetryable = statusCode === 429 || statusCode === 503 || statusCode === 529
  let message = raw
  try {
    const jsonStart = raw.indexOf('{')
    if (jsonStart !== -1) {
      const parsed = JSON.parse(raw.slice(jsonStart))
      if (parsed?.error?.message) {
        message = parsed.error.message
      } else if (typeof parsed?.message === 'string') {
        message = parsed.message
      }
    }
  } catch {}
  return { name: 'APIError', data: { message, statusCode, isRetryable } }
}

function extractToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text)
    } else if (b.type === 'image') {
      const src = b.source as Record<string, unknown> | undefined
      if (typeof src?.data === 'string') {
        parts.push(`[image: ${src.type}]`)
      }
    }
  }
  return parts.join('\n')
}

function getActiveSubagentId(ctx: MessageRouterCtx): string | undefined {
  const subs = ctx.getActiveSubagents()
  if (subs.size === 0) return undefined
  return subs.keys().next().value as string | undefined
}

export type SubagentInfo = {
  agentId: string
  agentType?: string
  description?: string
  prompt?: string
  toolUseId?: string
}

export type StdoutMessage = {
  type: string
  [key: string]: unknown
}

export type MessageRouterCtx = {
  readonly sessionId: string
  readonly silent: boolean

  getStatus(): SessionState
  getBusyStatus(): SessionBusyStatus
  getModel(): string | undefined
  getProviderId(): string | undefined
  getInitRequestId(): string | null
  getLastMessageUuid(): string | null

  setStatus(status: SessionState): void
  setBusyStatus(status: SessionBusyStatus): void
  setModel(model: string): void
  setProviderId(id: string): void
  setInitData(data: InitData): void
  setLastMessageUuid(uuid: string): void
  setLastActiveAt(ts: number): void

  getActiveSubagents(): Map<string, SubagentInfo>
  registerSubagent(info: SubagentInfo): void
  unregisterSubagent(agentId: string): void

  getControlChannel(): ControlChannel
  getPendingPermissions(): Map<string, PendingPermission>
  getPendingQuestions(): Map<string, PendingQuestion>

  resolveInit(data: InitData): void
  resolvePrompt(value: { done: boolean; error?: string }): void

  addCost(cost: number): void
  addInputTokens(tokens: number): void
  addOutputTokens(tokens: number): void

  emitEvent(event: string, data: Record<string, unknown>): void
  emitOpencodeEvent(event: string, properties: Record<string, unknown>): void
  emitBusyStatus(): void
  emitMessage(msg: StdoutMessage): void
  writeStdin(data: string): void
  pushBufferMessage(msg: SessionMessage): void
  addTombstonedUuid(uuid: string): void
}

export function routeMessage(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  if (
    ctx.getStatus() === 'starting' &&
    msg.type === 'control_response'
  ) {
    const response = msg.response as Record<string, unknown> | undefined
    if (response?.subtype === 'success' && response?.request_id === ctx.getInitRequestId()) {
      handleInitResponse(response, ctx)
      return
    }
  }

  if (msg.type === 'control_response') {
    if (ctx.getControlChannel().tryResolve(msg)) return
  }

  ctx.emitMessage(msg)

  switch (msg.type) {
    case 'assistant': {
      handleAssistantMessage(msg, ctx)
      break
    }
    case 'user': {
      handleUserMessage(msg, ctx)
      break
    }
    case 'result': {
      handleResultMessage(msg, ctx)
      break
    }
    case 'control_request': {
      handleControlRequest(msg, ctx)
      break
    }
    case 'control_cancel_request': {
      handleCancelRequest(msg, ctx)
      break
    }
    case 'stream_event': {
      handleStreamEvent(msg, ctx)
      break
    }
    case 'system': {
      handleSystemMessage(msg, ctx)
      break
    }
    case 'attachment': {
      handleAttachment(msg, ctx)
      break
    }
    case 'progress': {
      handleProgress(msg, ctx)
      break
    }
    case 'tombstone': {
      handleTombstone(msg, ctx)
      break
    }
    default: {
      break
    }
  }
}

function handleInitResponse(response: Record<string, unknown>, ctx: MessageRouterCtx): void {
  const initData = (response.response ?? {}) as InitData
  ctx.setInitData(initData)
  if (Array.isArray(initData.models) && initData.models.length > 0 && !ctx.getModel()) {
    const first = (initData.models as Array<Record<string, string>>)[0]
    ctx.setModel(first?.value ?? first?.name)
  }
  if (initData.account?.apiProvider) {
    ctx.setProviderId(initData.account.apiProvider)
  }
  ctx.setStatus('running')
  ctx.setLastActiveAt(Date.now())
  ctx.resolveInit(initData)
  ctx.emitOpencodeEvent('session.updated', {
    sessionID: ctx.sessionId,
    status: 'running',
    model: ctx.getModel(),
    providerID: ctx.getProviderId(),
  })
}

function handleAssistantMessage(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.setLastActiveAt(Date.now())
  ctx.setStatus('running')
  if (msg.uuid && typeof msg.uuid === 'string') {
    ctx.setLastMessageUuid(msg.uuid)
  }
  const rawContent = (msg.message as Record<string, unknown>)?.content ?? msg.content
  const isApiError = isApiErrorContent(rawContent)
  const agentId = (msg.agent_id as string | undefined) || getActiveSubagentId(ctx)
  const emitSessionID = agentId && ctx.getActiveSubagents().has(agentId) ? agentId : ctx.sessionId
  const wasStreamed = hasActiveStream(emitSessionID) || consumeStreamedTurn(emitSessionID)

  if (msg.uuid) {
    ctx.pushBufferMessage({
      uuid: msg.uuid as string,
      type: 'assistant',
      role: 'assistant',
      content: isApiError ? [] : (msg.message ?? msg.content ?? ''),
      timestamp: msg.timestamp ? new Date(msg.timestamp as string).getTime() : Date.now(),
      parent_uuid: (msg.parentUuid as string) ?? null,
      ...(isApiError ? { error: buildErrorFromContent(rawContent) } : {}),
    })
  }

  if (wasStreamed) {
    if (Array.isArray(rawContent)) {
      for (const block of rawContent) {
        const b = block as Record<string, unknown>
        if (b.type !== 'tool_result') continue
        const toolUseID = b.tool_use_id as string
        if (!toolUseID) continue
        const toolInfo = getCompletedToolInfo(emitSessionID, toolUseID)
        const output = extractToolResultContent(b.content)
        const isError = b.is_error === true
        ctx.emitOpencodeEvent('message.part.updated', {
          sessionID: emitSessionID,
          part: {
            type: 'tool',
            id: toolInfo?.partID ?? randomUUID(),
            callID: toolUseID,
            tool: toolInfo?.toolName ? normalizeToolName(toolInfo.toolName) : '',
            messageID: ctx.getLastMessageUuid() ?? '',
            sessionID: emitSessionID,
            state: {
              status: isError ? 'error' : 'completed',
              input: toolInfo?.input ?? {},
              title: toolInfo?.title ?? toolInfo?.toolName ?? '',
              ...(isError ? { error: output } : { output }),
              time: { start: toolInfo?.startTime ?? Date.now(), end: Date.now() },
            },
          },
        })
      }
    }
    return
  }

  let enriched = msg
  if (!msg.model && ctx.getModel()) {
    enriched = { ...enriched, model: ctx.getModel() }
  }
  if (!msg.provider_id && ctx.getProviderId()) {
    enriched = { ...enriched, provider_id: ctx.getProviderId() }
  }
  const assistantMsgID = (msg.uuid as string) ?? randomUUID()
  ctx.emitOpencodeEvent('message.updated', {
    sessionID: emitSessionID,
    info: {
      id: assistantMsgID,
      role: 'assistant',
      modelID: enriched.model,
      providerID: enriched.provider_id,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: {
        created: msg.timestamp
          ? new Date(msg.timestamp as string).getTime()
          : Date.now(),
      },
      parentID: (msg.parentUuid as string) ?? null,
      ...(isApiError ? { error: buildErrorFromContent(rawContent) } : {}),
    },
  })

  if (Array.isArray(rawContent)) {
    for (const block of rawContent) {
        const part = buildPartFromContentBlock(block as Record<string, unknown>, assistantMsgID, emitSessionID)
      if (part) {
        if (isApiError && part.type === 'text') continue
        ctx.emitOpencodeEvent('message.part.updated', {
          sessionID: emitSessionID,
          part,
        })
      }
    }
  }
}

function handleUserMessage(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  if (msg.isReplay) return

  const agentId = (msg.agent_id as string | undefined) || getActiveSubagentId(ctx)
  const emitSessionID = agentId && ctx.getActiveSubagents().has(agentId) ? agentId : ctx.sessionId

  let rawContent = msg.message ?? msg.content
  if (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent) && 'content' in (rawContent as Record<string, unknown>)) {
    rawContent = (rawContent as Record<string, unknown>).content
  }
  if (Array.isArray(rawContent)) {
    for (const block of rawContent) {
      const b = block as Record<string, unknown>
      if (b.type !== 'tool_result') continue
      const toolUseID = b.tool_use_id as string
      if (!toolUseID) continue
      const output = extractToolResultContent(b.content)
      const isError = b.is_error === true
      const toolInfo = getCompletedToolInfo(emitSessionID, toolUseID)
      ctx.emitOpencodeEvent('message.part.updated', {
        sessionID: emitSessionID,
        part: {
          type: 'tool',
          id: toolInfo?.partID ?? randomUUID(),
          callID: toolUseID,
          tool: toolInfo?.toolName ? normalizeToolName(toolInfo.toolName) : '',
          messageID: toolInfo?.messageID,
          sessionID: emitSessionID,
          state: {
            status: isError ? 'error' : 'completed',
            input: toolInfo?.input ?? {},
            title: toolInfo?.title ?? toolInfo?.toolName ?? '',
            ...(isError ? { error: output } : { output }),
            time: { start: toolInfo?.startTime, end: Date.now() },
          },
        },
      })
    }
  }

  const content = typeof msg.content === 'string' ? msg.content : ''
  if (content.includes('<local-command-stdout>')) return
  ctx.emitOpencodeEvent('message.updated', {
    sessionID: emitSessionID,
    info: {
      id: (msg.uuid as string) ?? randomUUID(),
      role: 'user',
      time: { created: Date.now() },
      parentID: null,
    },
  })
}

function handleResultMessage(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.setLastActiveAt(Date.now())
  ctx.setStatus('running')
  const cost = msg.cost_usd as number | undefined
  const usage = msg.usage as
    | { input_tokens?: number; output_tokens?: number }
    | undefined
  if (cost) ctx.addCost(cost)
  if (usage?.input_tokens) ctx.addInputTokens(usage.input_tokens)
  if (usage?.output_tokens) ctx.addOutputTokens(usage.output_tokens)
  ctx.setBusyStatus({ type: 'idle' })
  ctx.emitBusyStatus()
  ctx.emitOpencodeEvent('session.result', {
    sessionID: ctx.sessionId,
    subtype: msg.subtype ?? 'success',
    costUsd: msg.cost_usd,
    usage: msg.usage,
    stopReason: msg.stop_reason,
  })

  const subtype = msg.subtype as string | undefined
  if (subtype && subtype !== 'success') {
    const errorData = msg.errors as Array<Record<string, unknown>> | undefined
    const errorMessage = errorData?.[0]?.message ?? msg.subtype ?? 'Unknown error'
    ctx.emitOpencodeEvent('session.error', {
      sessionID: ctx.sessionId,
      error: {
        subtype,
        level: 'error',
        message: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
      },
    })
  }

  ctx.resolvePrompt({ done: true })
}

function handleStreamEvent(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.setLastActiveAt(Date.now())
  const event = msg.event as Record<string, unknown> | undefined
  if (!event) return

  const agentId = msg.agent_id as string | undefined
  const subagentActive = agentId && ctx.getActiveSubagents().has(agentId)
  const emitSessionID = subagentActive ? agentId! : ctx.sessionId
  const canonicalEvents = processStreamEvent(emitSessionID, event)
  for (const ce of canonicalEvents) {
    ctx.emitOpencodeEvent(ce.type, ce.properties)
  }
}

function handleSystemMessage(msg: StdoutMessage, ctx: MessageRouterCtx): void {
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
    case 'turn_duration':
      emitSessionMetrics(msg, ctx)
      break
    case 'cache_warning':
      emitSessionWarning(msg, ctx)
      break
    case 'informational':
    case 'post_turn_summary':
      emitSessionInfo(msg, ctx)
      break
    case 'session_state_changed':
    case 'status':
      emitSessionStatus(msg, ctx)
      break
    default:
      if (subtype) {
        emitSessionInfo(msg, ctx)
      }
      break
  }
}

function handleAttachment(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('message.attachment', {
    sessionID: ctx.sessionId,
    attachmentType: (msg.attachment as Record<string, unknown>)?.type,
    attachment: msg.attachment,
  })
}

function handleProgress(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('tool.progress', {
    sessionID: ctx.sessionId,
    toolUseID: msg.toolUseID,
    parentToolUseID: msg.parentToolUseID,
    data: msg.data,
  })
}

function handleTombstone(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  const messageObj = msg.message as Record<string, unknown> | undefined
  const targetUuid = messageObj?.uuid as string | undefined
  if (targetUuid) {
    ctx.addTombstonedUuid(targetUuid)
    ctx.emitOpencodeEvent('message.removed', {
      sessionID: ctx.sessionId,
      messageID: targetUuid,
    })
  }
}

function handleControlRequest(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  const request = msg.request as Record<string, unknown> | undefined
  const requestId = msg.request_id as string

  if (request?.subtype === 'can_use_tool') {
    const toolName = (request.tool_name as string) ?? 'Unknown'
    const perm: PendingPermission = {
      requestId,
      sessionId: ctx.sessionId,
      toolName,
      toolUseId: (request.tool_use_id as string) ?? '',
      input: (request.input as Record<string, unknown>) ?? {},
      title: `${request.tool_name}: ${JSON.stringify(request.input).slice(0, 80)}`,
      description: `Execute ${request.tool_name}`,
      suggestions:
        (request.permission_suggestions as Record<string, unknown>[]) ?? [],
    }
    ctx.getPendingPermissions().set(requestId, perm)
    ctx.emitEvent('control_request', { request_id: requestId, request })

    if (toolName === 'AskUserQuestion') {
      const input = (request.input as Record<string, unknown>) ?? {}
      const questions = (input.questions as Array<Record<string, unknown>>) ?? []
      ctx.emitOpencodeEvent('question.asked', {
        sessionID: ctx.sessionId,
        id: requestId,
        questions: questions.map(q => ({
          question: q.question as string,
          header: (q.header as string) ?? '',
          options: ((q.options as Array<{ label: string; description: string }>) ?? []).map(o => ({
            label: o.label,
            description: o.description,
          })),
          multiple: (q.multiSelect as boolean) ?? false,
          custom: false,
        })),
        tool: {
          messageID: '',
          callID: perm.toolUseId,
        },
      })
    } else {
      ctx.emitOpencodeEvent('permission.asked', {
        sessionID: ctx.sessionId,
        id: requestId,
        permission: toPermissionKey(toolName),
        patterns: extractPatterns(perm.input),
        metadata: { input: perm.input },
        always: [] as string[],
        tool: {
          messageID: '',
          callID: perm.toolUseId,
        },
      })
    }
  } else if (request?.subtype === 'elicitation') {
    const question: PendingQuestion = {
      requestId,
      sessionId: ctx.sessionId,
      mcpServerName: (request.mcp_server_name as string) ?? '',
      message: (request.message as string) ?? '',
      mode: (request.mode as string) ?? 'form',
      requestedSchema:
        (request.requested_schema as Record<string, unknown>) ?? {},
    }
    ctx.getPendingQuestions().set(requestId, question)
    ctx.emitEvent('control_request', { request_id: requestId, request })

    ctx.emitOpencodeEvent('question.asked', {
      sessionID: ctx.sessionId,
      id: requestId,
      questions: [{
        question: question.message,
        header: question.mcpServerName || 'MCP',
        options: [] as Array<{ label: string; description: string }>,
        multiple: false,
        custom: true,
      }],
    })
  } else if (request?.subtype === 'hook_callback') {
    ctx.emitEvent('control_request', { request_id: requestId, request })
    const callbackId = request.callback_id as string | undefined
    if (!callbackId || callbackId === 'AUTO_APPROVE_CALLBACK_ID') {
      ctx.writeStdin(jsonStringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              permissionDecisionReason: 'Auto-approved by serve',
            },
          },
        },
      }))
    } else {
      ctx.writeStdin(jsonStringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'ask',
              permissionDecisionReason: 'Forwarding to can_use_tool',
            },
          },
        },
      }))
    }
  }
}

function handleCancelRequest(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  const cancelRequestId = msg.request_id as string
  const wasPerm = ctx.getPendingPermissions().has(cancelRequestId)
  const wasQuestion = ctx.getPendingQuestions().has(cancelRequestId)
  ctx.getPendingPermissions().delete(cancelRequestId)
  ctx.getPendingQuestions().delete(cancelRequestId)
  if (wasQuestion) {
    ctx.emitOpencodeEvent('question.rejected', {
      sessionID: ctx.sessionId,
      requestID: cancelRequestId,
    })
  }
  if (wasPerm) {
    ctx.emitOpencodeEvent('permission.replied', {
      sessionID: ctx.sessionId,
      requestID: cancelRequestId,
    })
  }
}

function buildPartFromContentBlock(block: Record<string, unknown>, messageID: string, sessionID: string): Record<string, unknown> | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', id: randomUUID(), text: block.text as string, messageID, sessionID }
    case 'thinking':
      return { type: 'reasoning', id: randomUUID(), text: block.thinking as string, messageID, sessionID }
    case 'redacted_thinking':
      return { type: 'reasoning', id: randomUUID(), text: '', redacted: true, messageID, sessionID }
    case 'tool_use': {
      const toolInput = normalizeToolInput(block.input as Record<string, unknown>)
      return {
        type: 'tool',
        id: randomUUID(),
        callID: block.id as string,
        tool: normalizeToolName(block.name as string),
        state: {
          status: 'running',
          input: toolInput,
          title: (toolInput?.description as string) ?? (block.name as string),
          time: { start: Date.now() },
        },
        messageID,
        sessionID,
      }
    }
    default:
      return null
  }
}

function normalizeToolName(name: string): string {
  return toPermissionKey(name)
}

function emitTaskStarted(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  const agentId = (msg.agent_id ?? msg.task_id) as string
  const taskType = msg.task_type as string | undefined
  const description = msg.description as string
  const prompt = msg.prompt as string | undefined
  const toolUseId = msg.tool_use_id as string | undefined
  const assistantMessageID = randomUUID()

  ctx.registerSubagent({
    agentId,
    agentType: taskType,
    description,
    prompt,
    toolUseId,
  })

  const toolUseIdForMain = toolUseId
  subagentToolState.set(agentId, {
    emittedToolCount: 0,
    assistantMessageID,
    toolPartIDs: new Map(),
    mainPartID: '',
    mainMessageID: '',
    mainToolUseID: toolUseIdForMain ?? '',
    progressLines: [],
  })

  ctx.emitOpencodeEvent('task.started', {
    sessionID: ctx.sessionId,
    taskID: msg.task_id as string,
    toolUseID: toolUseId,
    description,
    taskType,
    workflowName: msg.workflow_name as string | undefined,
    prompt,
  })

  ctx.emitOpencodeEvent('session.created', {
    sessionID: agentId,
    info: {
      id: agentId,
      parentID: ctx.sessionId,
      title: description || `Subagent ${agentId.slice(0, 8)}`,
      agent: taskType ?? 'general-purpose',
      createdAt: Date.now(),
      status: 'running',
    },
  })

  ctx.emitOpencodeEvent('message.updated', {
    sessionID: agentId,
    info: {
      id: assistantMessageID,
      role: 'assistant',
      modelID: 'subagent',
      time: { created: Date.now() },
      parentID: null,
    },
  })

  ctx.emitOpencodeEvent('session.status', {
    sessionID: agentId,
    status: { type: 'busy' },
  })

  if (toolUseId) {
    registerAgentSession(ctx.sessionId, toolUseId, agentId)
  }
}

function emitTaskProgress(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  const agentId = (msg.agent_id ?? msg.task_id) as string
  const usage = msg.usage as { duration_ms?: number; tool_uses?: number; total_tokens?: number } | undefined
  const toolUses = usage?.tool_uses ?? 0
  const lastToolName = (msg.last_tool_name as string | undefined) ?? 'Tool'
  const description = msg.description as string | undefined

  ctx.emitOpencodeEvent('task.progress', {
    sessionID: ctx.sessionId,
    taskID: msg.task_id as string,
    description,
    usage,
    lastToolName,
    summary: msg.summary as string | undefined,
    workflowProgress: msg.workflow_progress,
  })

  const toolState = subagentToolState.get(agentId)
  if (!toolState) return

  if (!toolState.mainPartID && toolState.mainToolUseID) {
    const info = getCompletedToolInfo(ctx.sessionId, toolState.mainToolUseID)
    if (info) {
      toolState.mainPartID = info.partID
      toolState.mainMessageID = info.messageID
    }
  }

  if (description && toolState.mainPartID) {
    const lines = toolState.progressLines
    lines.push(description)
    if (lines.length > 3) lines.splice(0, lines.length - 3)
    toolState.progressLines = lines

    const mainToolInfo = getCompletedToolInfo(ctx.sessionId, toolState.mainToolUseID)
    ctx.emitOpencodeEvent('message.part.updated', {
      sessionID: ctx.sessionId,
      part: {
        type: 'tool',
        id: toolState.mainPartID,
        callID: toolState.mainToolUseID,
        tool: mainToolInfo?.toolName ? normalizeToolName(mainToolInfo.toolName) : 'task',
        state: {
          status: 'running',
          input: mainToolInfo?.input ?? {},
          title: mainToolInfo?.title ?? '',
          time: { start: mainToolInfo?.startTime ?? Date.now() },
          progress: toolState.progressLines,
        },
        messageID: toolState.mainMessageID,
        sessionID: ctx.sessionId,
      },
    })
  }

  while (toolState.emittedToolCount < toolUses) {
    toolState.emittedToolCount++
    const toolIndex = toolState.emittedToolCount
    const isLast = toolIndex === toolUses
    const toolName = toolIndex === toolUses ? lastToolName : 'Tool'

    let partID = toolState.toolPartIDs.get(toolIndex)
    if (!partID) {
      partID = randomUUID()
      toolState.toolPartIDs.set(toolIndex, partID)
    }

    ctx.emitOpencodeEvent('message.part.updated', {
      sessionID: agentId,
      part: {
        type: 'tool',
        id: partID,
        callID: `subagent-tool-${toolIndex}`,
        tool: normalizeToolName(toolName),
        state: {
          status: 'completed',
          output: isLast && description ? description.replace(/^Running\s*/i, '') : '',
          title: `${toolName} #${toolIndex}`,
          time: { start: Date.now() - (usage?.duration_ms ?? 0), end: Date.now() },
        },
        messageID: toolState.assistantMessageID,
        sessionID: agentId,
      },
    })
  }
}

function emitTaskCompleted(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  const agentId = (msg.agent_id ?? msg.task_id) as string
  const status = msg.status as 'completed' | 'failed' | 'stopped'
  const summary = msg.summary as string
  const toolUseId = msg.tool_use_id as string | undefined
  const toolState = subagentToolState.get(agentId)

  ctx.emitOpencodeEvent('task.completed', {
    sessionID: ctx.sessionId,
    taskID: msg.task_id as string,
    toolUseID: toolUseId,
    status,
    summary,
    outputFile: msg.output_file as string,
    usage: msg.usage,
  })

  if (toolUseId) {
    const agentToolInfo = getCompletedToolInfo(ctx.sessionId, toolUseId)
    ctx.emitOpencodeEvent('message.part.updated', {
      sessionID: ctx.sessionId,
      part: {
        type: 'tool',
        id: agentToolInfo?.partID ?? randomUUID(),
        callID: toolUseId,
        tool: agentToolInfo?.toolName ? normalizeToolName(agentToolInfo.toolName) : undefined,
        messageID: agentToolInfo?.messageID,
        sessionID: ctx.sessionId,
        state: {
          status: status === 'failed' ? 'error' : 'completed',
          input: agentToolInfo?.input ?? {},
          ...(status === 'failed' ? { error: summary || 'Task failed' } : { output: summary || '' }),
          title: summary || '',
          time: { start: agentToolInfo?.startTime, end: Date.now() },
        },
      },
    })
  }

  if (toolState) {
    ctx.emitOpencodeEvent('message.updated', {
      sessionID: agentId,
      info: {
        id: toolState.assistantMessageID,
        role: 'assistant',
        modelID: 'subagent',
        time: { completed: Date.now() },
      },
    })
    subagentToolState.delete(agentId)
  }

  const subagent = ctx.getActiveSubagents().get(agentId)
  if (subagent || agentId) {
    ctx.emitOpencodeEvent('session.updated', {
      sessionID: agentId,
      info: {
        id: agentId,
        status,
        summary,
        completedAt: Date.now(),
      },
    })

    ctx.emitOpencodeEvent('session.status', {
      sessionID: agentId,
      status: { type: 'idle' },
    })

    ctx.emitOpencodeEvent('session.idle', {
      sessionID: agentId,
    })

    ctx.unregisterSubagent(agentId)
  }
}

function emitSessionError(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('session.error', {
    sessionID: ctx.sessionId,
    error: {
      subtype: msg.subtype,
      level: msg.level ?? 'error',
      message: msg.content ?? (msg.error as Record<string, unknown>)?.message,
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
      id: (msg.uuid as string) ?? randomUUID(),
      auto:
        msg.subtype === 'microcompact_boundary' ||
        ((msg.compact_metadata as Record<string, unknown>)?.trigger === 'auto'),
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

function emitSessionMetrics(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('session.metrics', {
    sessionID: ctx.sessionId,
    turnDuration: msg.duration ?? msg.turn_duration,
  })
}

function emitSessionWarning(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('session.warning', {
    sessionID: ctx.sessionId,
    message: msg.content,
  })
}

function emitSessionInfo(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('session.info', {
    sessionID: ctx.sessionId,
    subtype: msg.subtype,
    content: msg.content,
  })
}

function emitSessionStatus(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.emitOpencodeEvent('session.status', {
    sessionID: ctx.sessionId,
    status: msg.status,
  })
}

function toPermissionKey(toolName: string): string {
  const map: Record<string, string> = {
    Read: 'read',
    Edit: 'edit',
    Write: 'edit',
    Glob: 'glob',
    Grep: 'grep',
    LS: 'list',
    Bash: 'bash',
    PowerShell: 'bash',
    Agent: 'task',
    WebFetch: 'webfetch',
    WebSearch: 'websearch',
    TodoRead: 'todoread',
    TodoWrite: 'todowrite',
  }
  return map[toolName] ?? toolName.toLowerCase()
}

function extractPatterns(input: Record<string, unknown>): string[] {
  const patterns: string[] = []
  for (const key of ['file_path', 'path', 'pattern', 'glob'] as const) {
    const v = typeof input[key] === 'string' ? input[key] : ''
    if (v) patterns.push(v)
  }
  const cmd = typeof input.command === 'string' ? input.command : ''
  if (cmd) patterns.push(cmd)
  return patterns
}

function normalizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const renames: Record<string, string> = {
    file_path: 'filePath',
    old_string: 'oldString',
    new_string: 'newString',
    replace_all: 'replaceAll',
  }
  for (const [oldKey, newKey] of Object.entries(renames)) {
    if (oldKey in input) {
      input[newKey] = input[oldKey]
      delete input[oldKey]
    }
  }
  return input
}
