import { describe, expect, test, mock } from 'bun:test'
import { SessionHandle } from '../sessionHandle.js'
import type { EventBus } from '../eventBus.js'

function createMockEventBus(): EventBus & { published: Array<{ event: string; data: Record<string, unknown> }> } {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const published: Array<{ event: string; data: Record<string, unknown> }> = []
  return {
    publishSessionEvent(sessionId: string, event: string, data: Record<string, unknown>) {
      events.push({ event, data: { session_id: sessionId, ...data } })
    },
    publish(event: string, data: unknown) {
      published.push({ event, data: data as Record<string, unknown> })
    },
    addClient() { return '' },
    removeClient() {},
    startHeartbeat() {},
    stopHeartbeat() {},
    clientCount() { return 0 },
    destroy() {},
    get published() { return published },
  } as unknown as EventBus & { published: Array<{ event: string; data: Record<string, unknown> }> }
}

describe('SessionHandle', () => {
  test('constructor sets properties', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      model: 'claude-sonnet-4-20250514',
      permissionMode: 'default',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    expect(handle.sessionId).toBe('test-id')
    expect(handle.cwd).toBe('/tmp')
    expect(handle.model).toBe('claude-sonnet-4-20250514')
    expect(handle.permissionMode).toBe('default')
    expect(handle.status).toBe('starting')
    expect(handle.prompting).toBe(false)
  })

  test('getInfo returns correct shape', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    const info = handle.getInfo()
    expect(info.session_id).toBe('test-id')
    expect(info.status).toBe('starting')
    expect(info.cwd).toBe('/tmp')
    expect(typeof info.created_at).toBe('number')
    expect(typeof info.last_active_at).toBe('number')
  })

  test('setTitle updates title', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    handle.setTitle('My Session')
    expect(handle.title).toBe('My Session')
  })

  test('onMessage returns unsubscribe function', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    const received: unknown[] = []
    const unsub = handle.onMessage(msg => received.push(msg))
    expect(typeof unsub).toBe('function')
    unsub()
  })

  test('prompt throws if stopped', async () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    handle.kill()
    expect(handle.prompt('hello')).rejects.toThrow('stopped')
  })

  test('getPendingPermissions returns empty initially', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    expect(handle.getPendingPermissions()).toEqual([])
  })

  test('getPendingQuestions returns empty initially', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    expect(handle.getPendingQuestions()).toEqual([])
  })

  test('kill sets status to stopped', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    handle.kill()
    expect(handle.status).toBe('stopped')
  })

  test('waitReady throws if stopped', async () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    handle.kill()
    expect(handle.waitReady(100)).rejects.toThrow('stopped')
  })

  test('ready returns false initially', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    expect(handle.ready).toBe(false)
  })

  test('usage returns token counts', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'test-id',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })
    const usage = handle.usage
    expect(usage).toEqual({ input_tokens: 0, output_tokens: 0 })
  })

  test('emits question.asked opencode event for AskUserQuestion can_use_tool', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'sess-1',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })

    // Simulate child process sending can_use_tool for AskUserQuestion
    ;(handle as unknown as Record<string, (msg: Record<string, unknown>) => void>).handleMessage({
      type: 'control_request',
      request_id: 'req-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        tool_use_id: 'tu-1',
        input: {
          questions: [
            {
              question: 'Which library?',
              header: 'Library',
              options: [
                { label: 'A', description: 'Option A' },
                { label: 'B', description: 'Option B' },
              ],
              multiSelect: false,
            },
          ],
        },
        permission_suggestions: [],
      },
    })

    // Permission should be recorded
    const perms = handle.getPendingPermissions()
    expect(perms).toHaveLength(1)
    expect(perms[0].toolName).toBe('AskUserQuestion')
    expect(perms[0].requestId).toBe('req-1')

    // question.asked opencode event should be published (flat shape for wrapEventStream)
    const askedEvent = bus.published.find(e => e.event === 'question.asked')
    expect(askedEvent).toBeDefined()
    const askedData = askedEvent!.data as Record<string, unknown>
    expect(askedData.session_id).toBe('sess-1')
    expect(askedData.sessionID).toBe('sess-1')
    expect(askedData.id).toBe('req-1')
    expect(askedData.questions).toMatchObject([
      {
        question: 'Which library?',
        header: 'Library',
        options: [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' },
        ],
        multiple: false,
        custom: false,
      },
    ])
  })

  test('emits permission.asked opencode event for regular tool can_use_tool', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'sess-1',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })

    ;(handle as unknown as Record<string, (msg: Record<string, unknown>) => void>).handleMessage({
      type: 'control_request',
      request_id: 'req-2',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'tu-2',
        input: { command: 'echo hello' },
        permission_suggestions: [],
      },
    })

    const perms = handle.getPendingPermissions()
    expect(perms).toHaveLength(1)
    expect(perms[0].toolName).toBe('Bash')

    const askedEvent = bus.published.find(e => e.event === 'permission.asked')
    expect(askedEvent).toBeDefined()
    const permData = askedEvent!.data as Record<string, unknown>
    expect(permData.session_id).toBe('sess-1')
    expect(permData.sessionID).toBe('sess-1')
    expect(permData.permission).toBe('bash')
  })

  test('emits question.replied opencode event when AskUserQuestion is allowed', () => {
    const bus = createMockEventBus()
    const handle = new SessionHandle({
      sessionId: 'sess-1',
      cwd: '/tmp',
      eventBus: bus,
      execPath: 'bun',
      scriptArgs: [],
    })

    // First inject the permission
    ;(handle as unknown as Record<string, (msg: Record<string, unknown>) => void>).handleMessage({
      type: 'control_request',
      request_id: 'req-3',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        tool_use_id: 'tu-3',
        input: { questions: [{ question: 'Q1?', header: 'H', options: [], multiSelect: false }] },
        permission_suggestions: [],
      },
    })

    expect(handle.getPendingPermissions()).toHaveLength(1)

    // Now reply allow
    handle.replyPermission('req-3', 'allow', { updatedInput: { answers: { 'Q1?': 'A' } } })

    expect(handle.getPendingPermissions()).toHaveLength(0)

    const repliedEvent = bus.published.find(e => e.event === 'question.replied')
    expect(repliedEvent).toBeDefined()
    const repliedData = repliedEvent!.data as Record<string, unknown>
    expect(repliedData.session_id).toBe('sess-1')
    expect(repliedData.sessionID).toBe('sess-1')
    expect(repliedData.requestID).toBe('req-3')
  })
})
