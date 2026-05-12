import { jsonStringify } from '../utils/slowOperations.js'
import type { ControlChannel } from './sessionControlChannel.js'
import type { SessionBusyStatus, SessionState, InitData, PendingPermission, PendingQuestion } from './types.js'

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
      ctx.setLastActiveAt(Date.now())
      ctx.emitEvent('stream_event', msg)
      break
    }
    case 'system': {
      ctx.emitEvent('message', msg)
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
  ctx.emitEvent('ready', {
    status: 'running',
    model: ctx.getModel(),
    provider_id: ctx.getProviderId(),
  })
}

function handleAssistantMessage(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  ctx.setLastActiveAt(Date.now())
  ctx.setStatus('running')
  if (msg.uuid && typeof msg.uuid === 'string') {
    ctx.setLastMessageUuid(msg.uuid)
  }
  let enriched = msg
  if (!msg.model && ctx.getModel()) {
    enriched = { ...enriched, model: ctx.getModel() }
  }
  if (!msg.provider_id && ctx.getProviderId()) {
    enriched = { ...enriched, provider_id: ctx.getProviderId() }
  }
  ctx.emitEvent('message', enriched)
}

function handleUserMessage(msg: StdoutMessage, ctx: MessageRouterCtx): void {
  if (msg.isReplay) return
  const content = typeof msg.content === 'string' ? msg.content : ''
  if (content.includes('<local-command-stdout>')) return
  ctx.emitEvent('message', msg)
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
  process.stderr.write(
    `[serve:timing:${ctx.sessionId}] result → idle emitted\n`,
  )
  ctx.emitEvent('result', msg)
  ctx.resolvePrompt({ done: true })
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
