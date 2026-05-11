import { describe, expect, test } from 'bun:test'
import { SessionManager } from '../sessionManager.js'
import { EventBus } from '../eventBus.js'

describe('SessionManager', () => {
  test('constructor sets defaults', () => {
    const bus = new EventBus()
    const mgr = new SessionManager({ eventBus: bus })
    expect(mgr.getActiveCount()).toBe(0)
  })

  test('getSession returns undefined for unknown id', () => {
    const bus = new EventBus()
    const mgr = new SessionManager({ eventBus: bus })
    expect(mgr.getSession('nonexistent')).toBeUndefined()
  })

  test('getAllSessions returns empty initially', () => {
    const bus = new EventBus()
    const mgr = new SessionManager({ eventBus: bus })
    expect(mgr.getAllSessions()).toEqual([])
  })

  test('getSessionStatuses returns empty object', async () => {
    const bus = new EventBus()
    const mgr = new SessionManager({ eventBus: bus })
    expect(await mgr.getSessionStatuses()).toEqual({})
  })

  test('getAllPendingPermissions returns empty', () => {
    const bus = new EventBus()
    const mgr = new SessionManager({ eventBus: bus })
    expect(mgr.getAllPendingPermissions()).toEqual([])
  })

  test('getAllPendingQuestions returns empty', () => {
    const bus = new EventBus()
    const mgr = new SessionManager({ eventBus: bus })
    expect(mgr.getAllPendingQuestions()).toEqual([])
  })

  test('findPermissionAcrossSessions returns null for unknown', () => {
    const bus = new EventBus()
    const mgr = new SessionManager({ eventBus: bus })
    expect(mgr.findPermissionAcrossSessions('nonexistent')).toBeNull()
  })

  test('findQuestionAcrossSessions returns null for unknown', () => {
    const bus = new EventBus()
    const mgr = new SessionManager({ eventBus: bus })
    expect(mgr.findQuestionAcrossSessions('nonexistent')).toBeNull()
  })

  test('deleteSession returns false for unknown id', async () => {
    const bus = new EventBus()
    const mgr = new SessionManager({ eventBus: bus })
    const result = await mgr.deleteSession('nonexistent')
    expect(result).toBe(false)
  })
})
