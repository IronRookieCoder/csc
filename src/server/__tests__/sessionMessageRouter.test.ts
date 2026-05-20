import { describe, expect, test, vi, afterEach } from 'bun:test'
import { routeMessage, type StdoutMessage, type MessageRouterCtx, type SubagentInfo } from '../sessionMessageRouter.js'
import { resetAllState } from '../streamStateTracker.js'
import type { ControlChannel } from '../sessionControlChannel.js'
import type { SessionState, SessionBusyStatus, InitData, PendingPermission, PendingQuestion } from '../types.js'
import type { SessionMessage } from '../transcriptReader.js'

type OCEvent = { event: string; properties: Record<string, unknown> }

type TestCtx = MessageRouterCtx & {
  oc: OCEvent[]
  ev: Array<{ event: string; data: Record<string, unknown> }>
  msgs: StdoutMessage[]
  buf: SessionMessage[]
}

afterEach(() => {
  resetAllState('test-session-1')
})

function makeCtx(overrides?: Partial<MessageRouterCtx>): TestCtx {
  const oc: OCEvent[] = []
  const ev: Array<{ event: string; data: Record<string, unknown> }> = []
  const msgs: StdoutMessage[] = []
  const buf: SessionMessage[] = []
  let _model: string | undefined
  let _providerId: string | undefined
  const _activeSubagents = new Map<string, SubagentInfo>()
  const base: MessageRouterCtx = {
    sessionId: 'test-session-1',
    silent: false,
    getStatus: () => 'running' as SessionState,
    getBusyStatus: () => ({ type: 'idle' }) as SessionBusyStatus,
    getModel: () => _model,
    getProviderId: () => _providerId,
    getInitRequestId: () => null,
    getLastMessageUuid: () => null,
    setStatus: vi.fn(),
    setBusyStatus: vi.fn(),
    setModel: (m: string) => { _model = m },
    setProviderId: (id: string) => { _providerId = id },
    setInitData: vi.fn(),
    setLastMessageUuid: vi.fn(),
    setLastActiveAt: vi.fn(),
    getActiveSubagents: () => _activeSubagents,
    registerSubagent: (info: SubagentInfo) => { _activeSubagents.set(info.agentId, info) },
    unregisterSubagent: (agentId: string) => { _activeSubagents.delete(agentId) },
    getControlChannel: () => ({ tryResolve: vi.fn() }) as unknown as ControlChannel,
    getPendingPermissions: () => new Map<string, PendingPermission>(),
    getPendingQuestions: () => new Map<string, PendingQuestion>(),
    resolveInit: vi.fn(),
    resolvePrompt: vi.fn(),
    addCost: vi.fn(),
    addInputTokens: vi.fn(),
    addOutputTokens: vi.fn(),
    emitEvent: (event, data) => { ev.push({ event, data }) },
    emitOpencodeEvent: (event, properties) => { oc.push({ event, properties }) },
    emitBusyStatus: vi.fn(),
    emitMessage: (msg) => { msgs.push(msg) },
    writeStdin: vi.fn(),
    pushBufferMessage: (msg) => { buf.push(msg) },
    addTombstonedUuid: vi.fn(),
  }
  const merged = { ...base, ...overrides }
  return { ...merged, oc, ev, msgs, buf } as TestCtx
}

describe('routeMessage — stream_event', () => {
  test('message_start emits message.updated + step-start', () => {
    const ctx = makeCtx()
    routeMessage({
      type: 'stream_event',
      event: { type: 'message_start', message: { model: 'claude-sonnet-4', usage: { input_tokens: 50 } } },
    }, ctx)
    const types = ctx.oc.map(e => e.event)
    expect(types).toContain('message.updated')
    expect(types).toContain('message.part.updated')
  })

  test('stream_event without event field is silently dropped', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'stream_event' }, ctx)
    expect(ctx.oc.length).toBe(0)
    expect(ctx.ev.length).toBe(0)
  })
})

describe('routeMessage — system subtype dispatch', () => {
  test('task_started → task.started + virtual session events + assistant message', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'task_started', task_id: 'task-1', description: 'Running agent', task_type: 'local_agent' }, ctx)
    expect(ctx.oc.length).toBe(4)
    expect(ctx.oc[0].event).toBe('task.started')
    expect(ctx.oc[0].properties).toMatchObject({ sessionID: 'test-session-1', taskID: 'task-1', taskType: 'local_agent' })
    expect(ctx.oc[1].event).toBe('session.created')
    expect(ctx.oc[1].properties).toMatchObject({ sessionID: 'task-1', info: { parentID: 'test-session-1', agent: 'local_agent' } })
    expect(ctx.oc[2].event).toBe('message.updated')
    expect(ctx.oc[2].properties).toMatchObject({ sessionID: 'task-1', info: { role: 'assistant', modelID: 'subagent' } })
    expect(ctx.oc[3].event).toBe('session.status')
    expect(ctx.oc[3].properties).toMatchObject({ sessionID: 'task-1', status: { type: 'busy' } })
    expect(ctx.getActiveSubagents().has('task-1')).toBe(true)
  })

  test('task_progress → task.progress', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'task_progress', task_id: 'task-1', usage: { total_tokens: 100 } }, ctx)
    expect(ctx.oc[0].event).toBe('task.progress')
  })

  test('task_progress with tool_uses emits tool parts on subagent session', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'task_started', task_id: 'task-1', description: 'Test agent' }, ctx)
    const assistantMsgID = (ctx.oc.find(e => e.event === 'message.updated' && e.properties.sessionID === 'task-1')?.properties as Record<string, unknown>)?.info as Record<string, unknown>
    expect(assistantMsgID).toBeDefined()
    expect(assistantMsgID.role).toBe('assistant')
    ctx.oc.length = 0

    routeMessage({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'task-1',
      last_tool_name: 'Bash',
      description: 'Running ls',
      usage: { duration_ms: 1000, tool_uses: 1, total_tokens: 0 },
    }, ctx)

    const progress = ctx.oc.find(e => e.event === 'task.progress')
    expect(progress).toBeDefined()

    const toolParts = ctx.oc.filter(e => e.event === 'message.part.updated')
    expect(toolParts.length).toBe(1)
    const part = toolParts[0].properties.part as Record<string, unknown>
    expect(part.type).toBe('tool')
    expect(part.tool).toBe('bash')
    expect((part.state as Record<string, unknown>).status).toBe('completed')
    expect(part.messageID).toBe(assistantMsgID.id)
    expect(part.sessionID).toBe('task-1')
  })

  test('task_progress emits incremental tool parts as tool_uses increases', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'task_started', task_id: 'task-1', description: 'Test agent' }, ctx)
    ctx.oc.length = 0

    routeMessage({
      type: 'system', subtype: 'task_progress', task_id: 'task-1',
      last_tool_name: 'Bash', description: 'Running ls', usage: { tool_uses: 1 },
    }, ctx)
    expect(ctx.oc.filter(e => e.event === 'message.part.updated').length).toBe(1)

    routeMessage({
      type: 'system', subtype: 'task_progress', task_id: 'task-1',
      last_tool_name: 'Read', description: 'Reading file', usage: { tool_uses: 2 },
    }, ctx)
    expect(ctx.oc.filter(e => e.event === 'message.part.updated').length).toBe(2)

    const parts = ctx.oc.filter(e => e.event === 'message.part.updated')
    const tool1 = parts[0].properties.part as Record<string, unknown>
    const tool2 = parts[1].properties.part as Record<string, unknown>
    expect(tool1.tool).toBe('bash')
    expect(tool2.tool).toBe('read')
    expect(tool1.id).not.toBe(tool2.id)
  })

  test('task_progress without prior task_started is a no-op for tool parts', () => {
    const ctx = makeCtx()
    routeMessage({
      type: 'system', subtype: 'task_progress', task_id: 'unknown-task',
      last_tool_name: 'Bash', usage: { tool_uses: 1 },
    }, ctx)
    expect(ctx.oc.filter(e => e.event === 'message.part.updated').length).toBe(0)
  })

  test('task_notification → task.completed + assistant message finalize + virtual session idle', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'task_started', task_id: 'task-1', agent_id: 'task-1', description: 'Test' }, ctx)
    ctx.oc.length = 0
    routeMessage({ type: 'system', subtype: 'task_notification', task_id: 'task-1', agent_id: 'task-1', status: 'completed', summary: 'Done', output_file: '/tmp/out' }, ctx)
    expect(ctx.oc[0].event).toBe('task.completed')
    expect(ctx.oc[0].properties).toMatchObject({ taskID: 'task-1', status: 'completed' })
    const msgUpdated = ctx.oc.filter(e => e.event === 'message.updated')
    expect(msgUpdated.length).toBe(1)
    expect(msgUpdated[0].properties).toMatchObject({ sessionID: 'task-1', info: { role: 'assistant', modelID: 'subagent' } })
    const info = msgUpdated[0].properties.info as Record<string, unknown>
    expect((info.time as Record<string, unknown>).completed).toBeDefined()
    const sessionUpdated = ctx.oc.filter(e => e.event === 'session.updated')
    expect(sessionUpdated.length).toBe(1)
    const sessionStatus = ctx.oc.filter(e => e.event === 'session.status')
    expect(sessionStatus.length).toBe(1)
    expect(sessionStatus[0].properties).toMatchObject({ sessionID: 'task-1', status: { type: 'idle' } })
    const idle = ctx.oc.filter(e => e.event === 'session.idle')
    expect(idle.length).toBe(1)
    expect(idle[0].properties).toMatchObject({ sessionID: 'task-1' })
    expect(ctx.getActiveSubagents().has('task-1')).toBe(false)
  })

  test('api_error → session.error', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'api_error', content: 'Rate limited', retry_in_ms: 5000, retry_attempt: 2, max_retries: 3 }, ctx)
    expect(ctx.oc[0].event).toBe('session.error')
    const err = ctx.oc[0].properties.error as Record<string, unknown>
    expect(err.subtype).toBe('api_error')
    expect(err.retryInMs).toBe(5000)
  })

  test('compact_boundary → compaction part', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'compact_boundary', uuid: 'uuid-1' }, ctx)
    expect(ctx.oc[0].event).toBe('message.part.updated')
    const part = ctx.oc[0].properties.part as Record<string, unknown>
    expect(part.type).toBe('compaction')
    expect(part.auto).toBe(false)
  })

  test('microcompact_boundary → compaction with auto=true', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'microcompact_boundary' }, ctx)
    const part = ctx.oc[0].properties.part as Record<string, unknown>
    expect(part.auto).toBe(true)
  })

  test('stop_hook_summary → session.hook_summary', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'stop_hook_summary', hook_count: 2, total_duration_ms: 100 }, ctx)
    expect(ctx.oc[0].event).toBe('session.hook_summary')
  })

  test('turn_duration → session.metrics', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'turn_duration', duration: 5000 }, ctx)
    expect(ctx.oc[0].event).toBe('session.metrics')
  })

  test('cache_warning → session.warning', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'cache_warning', content: 'Miss' }, ctx)
    expect(ctx.oc[0].event).toBe('session.warning')
  })

  test('informational → session.info', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'informational', content: 'Info' }, ctx)
    expect(ctx.oc[0].event).toBe('session.info')
  })

  test('unknown subtype → session.info', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'custom_subtype', content: 'data' }, ctx)
    expect(ctx.oc[0].event).toBe('session.info')
    expect(ctx.oc[0].properties.subtype).toBe('custom_subtype')
  })

  test('session_state_changed → session.status', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'system', subtype: 'session_state_changed', status: 'compacting' }, ctx)
    expect(ctx.oc[0].event).toBe('session.status')
  })
})

describe('routeMessage — attachment', () => {
  test('attachment → message.attachment', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'attachment', attachment: { type: 'hook_success', data: 'ok' } }, ctx)
    expect(ctx.oc.length).toBe(1)
    expect(ctx.oc[0].event).toBe('message.attachment')
    expect(ctx.oc[0].properties.attachmentType).toBe('hook_success')
  })
})

describe('routeMessage — progress', () => {
  test('progress → tool.progress', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'progress', toolUseID: 'tool-1', data: { type: 'bash_progress' } }, ctx)
    expect(ctx.oc.length).toBe(1)
    expect(ctx.oc[0].event).toBe('tool.progress')
    expect(ctx.oc[0].properties.toolUseID).toBe('tool-1')
  })
})

describe('routeMessage — tombstone', () => {
  test('tombstone → message.removed', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'tombstone', message: { uuid: 'dead-msg-uuid' } }, ctx)
    expect(ctx.oc.length).toBe(1)
    expect(ctx.oc[0].event).toBe('message.removed')
    expect(ctx.oc[0].properties.messageID).toBe('dead-msg-uuid')
  })

  test('tombstone without uuid is dropped', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'tombstone', message: {} }, ctx)
    expect(ctx.oc.length).toBe(0)
  })
})

describe('routeMessage — assistant (non-streaming)', () => {
  test('emits message.updated + parts for content blocks', () => {
    const ctx = makeCtx()
    routeMessage({
      type: 'assistant',
      uuid: 'msg-1',
      model: 'claude-sonnet-4',
      provider_id: 'anthropic',
      timestamp: '2026-05-18T00:00:00Z',
      parentUuid: 'parent-1',
      message: {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'thinking', thinking: 'Let me think...' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    }, ctx)

    const updated = ctx.oc.filter(e => e.event === 'message.updated')
    const parts = ctx.oc.filter(e => e.event === 'message.part.updated')
    expect(updated.length).toBe(1)
    expect(updated[0].properties.info).toMatchObject({ role: 'assistant', modelID: 'claude-sonnet-4', parentID: 'parent-1' })
    expect(parts.length).toBe(3)
    const partTypes = parts.map(e => (e.properties.part as Record<string, unknown>)?.type)
    expect(partTypes).toEqual(['text', 'reasoning', 'tool'])
  })

  test('redacted_thinking emits reasoning part with redacted=true', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'assistant', uuid: 'msg-1', message: { content: [{ type: 'redacted_thinking' }] } }, ctx)
    const part = ctx.oc.find(e => e.event === 'message.part.updated')
    const p = part?.properties.part as Record<string, unknown>
    expect(p.type).toBe('reasoning')
    expect(p.redacted).toBe(true)
  })

  test('pushes to buffer when uuid present', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'assistant', uuid: 'msg-1', message: { content: [] } }, ctx)
    expect(ctx.buf.length).toBe(1)
    expect(ctx.buf[0].uuid).toBe('msg-1')
  })

  test('API error content emits message.updated with role=error + error object', () => {
    const ctx = makeCtx()
    routeMessage({
      type: 'assistant',
      uuid: 'err-1',
      model: 'claude-sonnet-4',
      provider_id: 'anthropic',
      message: {
        content: [{ type: 'text', text: 'API Error: 429 {"error":{"code":"1305","message":"rate limited"}}' }],
      },
    }, ctx)
    const updated = ctx.oc.filter(e => e.event === 'message.updated')
    expect(updated.length).toBe(1)
    const info = updated[0].properties.info as Record<string, unknown>
    expect(info.role).toBe('assistant')
    expect(info.error).toMatchObject({ name: 'APIError', data: { statusCode: 429, isRetryable: true } })
    expect((info.error as any).data.message).toContain('rate limited')
    expect(ctx.buf[0].role).toBe('assistant')
    expect(ctx.buf[0].error).toBeDefined()
  })

  test('CoStrict API error content also detected', () => {
    const ctx = makeCtx()
    routeMessage({
      type: 'assistant',
      uuid: 'err-2',
      message: {
        content: [{ type: 'text', text: 'CoStrict API Error: something broke' }],
      },
    }, ctx)
    const info = (ctx.oc.find(e => e.event === 'message.updated')?.properties as Record<string, unknown>)?.info as Record<string, unknown>
    expect(info.role).toBe('assistant')
    expect((info.error as any).data.message).toBe('something broke')
  })
})

describe('routeMessage — result', () => {
  test('success emits session.result only', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'result', subtype: 'success', cost_usd: 0.05, usage: { input_tokens: 100, output_tokens: 50 } }, ctx)
    expect(ctx.oc.filter(e => e.event === 'session.result').length).toBe(1)
    expect(ctx.oc.filter(e => e.event === 'session.error').length).toBe(0)
  })

  test('error subtype emits session.error', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: [{ message: 'Max turns reached' }] }, ctx)
    const errors = ctx.oc.filter(e => e.event === 'session.error')
    expect(errors.length).toBe(1)
    expect(errors[0].properties.error).toMatchObject({ subtype: 'error_max_turns', level: 'error', message: 'Max turns reached' })
  })

  test('accumulates cost and tokens', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'result', subtype: 'success', cost_usd: 0.05, usage: { input_tokens: 100, output_tokens: 50 } }, ctx)
    expect(ctx.addCost).toHaveBeenCalledWith(0.05)
    expect(ctx.addInputTokens).toHaveBeenCalledWith(100)
    expect(ctx.addOutputTokens).toHaveBeenCalledWith(50)
  })
})

describe('routeMessage — init', () => {
  test('init response emits session.updated', () => {
    const ctx = makeCtx({
      getStatus: () => 'starting',
      getInitRequestId: () => 'init-req-1',
    })
    routeMessage({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'init-req-1',
        response: { models: [{ value: 'claude-sonnet-4' }], account: { apiProvider: 'anthropic' } },
      },
    }, ctx)
    const updated = ctx.oc.filter(e => e.event === 'session.updated')
    expect(updated.length).toBe(1)
    expect(updated[0].properties).toMatchObject({ status: 'running', model: 'claude-sonnet-4', providerID: 'anthropic' })
  })
})

describe('routeMessage — user', () => {
  test('emits message.updated', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'user', uuid: 'user-1', content: 'Hello' }, ctx)
    expect(ctx.oc.length).toBe(1)
    expect(ctx.oc[0].event).toBe('message.updated')
    expect(ctx.oc[0].properties.info).toMatchObject({ role: 'user' })
  })

  test('replay is dropped', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'user', content: 'replay', isReplay: true }, ctx)
    expect(ctx.oc.length).toBe(0)
  })

  test('local-command-stdout is dropped', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'user', content: '<local-command-stdout>out</local-command-stdout>' }, ctx)
    expect(ctx.oc.length).toBe(0)
  })
})

describe('routeMessage — unknown type', () => {
  test('unknown message type is silently dropped', () => {
    const ctx = makeCtx()
    routeMessage({ type: 'unknown_type', data: 'test' }, ctx)
    expect(ctx.oc.length).toBe(0)
  })
})
