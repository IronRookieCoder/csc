import { describe, expect, test, mock } from 'bun:test'
import { SessionHandle } from '../sessionHandle.js'
import type { EventBus } from '../eventBus.js'

function createMockEventBus(): EventBus {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  return {
    publishSessionEvent(sessionId: string, event: string, data: Record<string, unknown>) {
      events.push({ event, data: { session_id: sessionId, ...data } })
    },
    publish() {},
    addClient() { return '' },
    removeClient() {},
    startHeartbeat() {},
    stopHeartbeat() {},
    clientCount() { return 0 },
    destroy() {},
  } as unknown as EventBus
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
})
