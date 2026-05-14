import { beforeEach, describe, expect, test } from 'bun:test'
import {
  notifyAutomationStateChanged,
  notifyPermissionModeChanged,
  notifySessionMetadataChanged,
  notifySessionStateChanged,
  registerSdkEventConsumer,
  resetSessionStateForTests,
  setPermissionModeChangedListener,
  setSessionMetadataChangedListener,
  setSessionStateChangedListener,
} from '../sessionState'

describe('sessionState metadata replay', () => {
  beforeEach(() => {
    resetSessionStateForTests()
  })

  test('replays cached automation state to listeners that attach later', () => {
    const seen: Array<Record<string, unknown>> = []

    notifyAutomationStateChanged({
      enabled: true,
      phase: 'standby',
      next_tick_at: 123,
      sleep_until: null,
    })

    setSessionMetadataChangedListener(
      metadata => {
        seen.push(metadata as Record<string, unknown>)
      },
      { replayCurrent: true },
    )

    expect(seen).toEqual([
      {
        automation_state: {
          enabled: true,
          phase: 'standby',
          next_tick_at: 123,
          sleep_until: null,
        },
      },
    ])
  })

  test('dedupes identical automation states after replay but forwards changes', () => {
    const seen: Array<Record<string, unknown>> = []

    notifyAutomationStateChanged({
      enabled: true,
      phase: 'standby',
      next_tick_at: 123,
      sleep_until: null,
    })
    setSessionMetadataChangedListener(
      metadata => {
        seen.push(metadata as Record<string, unknown>)
      },
      { replayCurrent: true },
    )

    notifyAutomationStateChanged({
      enabled: true,
      phase: 'standby',
      next_tick_at: 123,
      sleep_until: null,
    })
    notifyAutomationStateChanged({
      enabled: true,
      phase: 'sleeping',
      next_tick_at: null,
      sleep_until: 456,
    })

    expect(seen).toEqual([
      {
        automation_state: {
          enabled: true,
          phase: 'standby',
          next_tick_at: 123,
          sleep_until: null,
        },
      },
      {
        automation_state: {
          enabled: true,
          phase: 'sleeping',
          next_tick_at: null,
          sleep_until: 456,
        },
      },
    ])
  })

  test('replays merged metadata snapshots instead of only the latest delta', () => {
    const seen: Array<Record<string, unknown>> = []

    notifySessionMetadataChanged({ model: 'claude-sonnet-4-6' })
    notifyAutomationStateChanged({
      enabled: true,
      phase: 'sleeping',
      next_tick_at: null,
      sleep_until: 456,
    })

    setSessionMetadataChangedListener(
      metadata => {
        seen.push(metadata as Record<string, unknown>)
      },
      { replayCurrent: true },
    )

    expect(seen).toEqual([
      {
        model: 'claude-sonnet-4-6',
        automation_state: {
          enabled: true,
          phase: 'sleeping',
          next_tick_at: null,
          sleep_until: 456,
        },
      },
    ])
  })

  test('replays pending_action metadata cached through session-state transitions', () => {
    const seen: Array<Record<string, unknown>> = []

    notifySessionStateChanged('requires_action', {
      tool_name: 'Edit',
      action_description: 'Edit src/utils/sessionState.ts',
      tool_use_id: 'toolu_123',
      request_id: 'req_123',
      input: { path: 'src/utils/sessionState.ts' },
    })

    setSessionMetadataChangedListener(
      metadata => {
        seen.push(metadata as Record<string, unknown>)
      },
      { replayCurrent: true },
    )

    expect(seen).toEqual([
      {
        pending_action: {
          tool_name: 'Edit',
          action_description: 'Edit src/utils/sessionState.ts',
          tool_use_id: 'toolu_123',
          request_id: 'req_123',
          input: { path: 'src/utils/sessionState.ts' },
        },
      },
    ])
  })

  test('replays cleared task_summary metadata after returning to idle', () => {
    const seen: Array<Record<string, unknown>> = []

    notifySessionMetadataChanged({ task_summary: 'Running regression suite' })
    notifySessionStateChanged('idle')

    setSessionMetadataChangedListener(
      metadata => {
        seen.push(metadata as Record<string, unknown>)
      },
      { replayCurrent: true },
    )

    expect(seen).toEqual([
      {
        task_summary: null,
      },
    ])
  })
})

describe('sessionState multi-subscriber', () => {
  beforeEach(() => {
    resetSessionStateForTests()
  })

  test('setSessionStateChangedListener returns unsubscribe function', () => {
    const calls: string[] = []
    const unsub = setSessionStateChangedListener(() => calls.push('L1'))

    notifySessionStateChanged('running')
    expect(calls).toEqual(['L1'])

    unsub()
    notifySessionStateChanged('idle')
    expect(calls).toEqual(['L1'])
  })

  test('multiple state listeners all receive notifications', () => {
    const calls: string[] = []
    setSessionStateChangedListener(() => calls.push('L1'))
    setSessionStateChangedListener(() => calls.push('L2'))
    setSessionStateChangedListener(() => calls.push('L3'))

    notifySessionStateChanged('running')

    expect(calls).toEqual(['L1', 'L2', 'L3'])
  })

  test('unsubscribed state listener does not receive subsequent notifications', () => {
    const calls: string[] = []
    const unsub1 = setSessionStateChangedListener(() => calls.push('L1'))
    setSessionStateChangedListener(() => calls.push('L2'))

    notifySessionStateChanged('running')
    expect(calls).toEqual(['L1', 'L2'])

    unsub1()
    calls.length = 0

    notifySessionStateChanged('requires_action')
    expect(calls).toEqual(['L2'])
  })

  test('state listeners receive state and details', () => {
    const received: Array<{ state: string; details?: Record<string, unknown> }> = []
    setSessionStateChangedListener((state, details) => {
      received.push({ state, details: details as Record<string, unknown> | undefined })
    })

    notifySessionStateChanged('requires_action', {
      tool_name: 'Bash',
      action_description: 'Running tests',
      tool_use_id: 'toolu_001',
      request_id: 'req_001',
    })

    expect(received).toEqual([
      {
        state: 'requires_action',
        details: {
          tool_name: 'Bash',
          action_description: 'Running tests',
          tool_use_id: 'toolu_001',
          request_id: 'req_001',
        },
      },
    ])
  })

  test('multiple metadata listeners all receive notifications', () => {
    const calls: string[] = []
    setSessionMetadataChangedListener(m => {
      calls.push(`L1:${m.model ?? 'no-model'}`)
    })
    setSessionMetadataChangedListener(m => {
      calls.push(`L2:${m.model ?? 'no-model'}`)
    })

    notifySessionMetadataChanged({ model: 'claude-sonnet-4-6' })

    expect(calls).toEqual(['L1:claude-sonnet-4-6', 'L2:claude-sonnet-4-6'])
  })

  test('unsubscribed metadata listener does not receive subsequent notifications', () => {
    const calls: string[] = []
    const unsub = setSessionMetadataChangedListener(m => {
      calls.push(`L1:${m.model ?? 'no-model'}`)
    })
    setSessionMetadataChangedListener(m => {
      calls.push(`L2:${m.model ?? 'no-model'}`)
    })

    notifySessionMetadataChanged({ model: 'opus-4' })
    expect(calls).toEqual(['L1:opus-4', 'L2:opus-4'])

    unsub()
    calls.length = 0

    notifySessionMetadataChanged({ model: 'sonnet-4' })
    expect(calls).toEqual(['L2:sonnet-4'])
  })

  test('metadata replay only fires for the subscribing listener', () => {
    const calls: string[] = []

    notifySessionMetadataChanged({ model: 'haiku-3.5' })

    setSessionMetadataChangedListener(
      m => calls.push(`L1:${m.model}`),
      { replayCurrent: true },
    )
    setSessionMetadataChangedListener(
      m => calls.push(`L2:${m.model}`),
      { replayCurrent: true },
    )

    expect(calls).toEqual(['L1:haiku-3.5', 'L2:haiku-3.5'])
  })

  test('multiple permission mode listeners all receive notifications', () => {
    const calls: string[] = []
    setPermissionModeChangedListener(m => calls.push(`L1:${m}`))
    setPermissionModeChangedListener(m => calls.push(`L2:${m}`))

    notifyPermissionModeChanged('plan' as never)

    expect(calls).toEqual(['L1:plan', 'L2:plan'])
  })

  test('unsubscribed permission mode listener does not receive subsequent notifications', () => {
    const calls: string[] = []
    const unsub = setPermissionModeChangedListener(m => calls.push(`L1:${m}`))
    setPermissionModeChangedListener(m => calls.push(`L2:${m}`))

    notifyPermissionModeChanged('default' as never)
    expect(calls).toEqual(['L1:default', 'L2:default'])

    unsub()
    calls.length = 0

    notifyPermissionModeChanged('acceptEdits' as never)
    expect(calls).toEqual(['L2:acceptEdits'])
  })

  test('resetSessionStateForTests clears all listeners and consumers', () => {
    const stateCalls: string[] = []
    const metadataCalls: string[] = []
    const permCalls: string[] = []
    const sdkCalls: string[] = []

    setSessionStateChangedListener(() => stateCalls.push('s'))
    setSessionMetadataChangedListener(() => metadataCalls.push('m'))
    setPermissionModeChangedListener(() => permCalls.push('p'))
    registerSdkEventConsumer(() => sdkCalls.push('e'))

    notifySessionStateChanged('running')
    notifySessionMetadataChanged({ model: 'test' })
    notifyPermissionModeChanged('plan' as never)

    expect(stateCalls).toEqual(['s'])
    expect(metadataCalls).toEqual(['m'])
    expect(permCalls).toEqual(['p'])
    expect(sdkCalls.length).toBeGreaterThan(0)

    resetSessionStateForTests()

    stateCalls.length = 0
    metadataCalls.length = 0
    permCalls.length = 0
    sdkCalls.length = 0

    notifySessionStateChanged('idle')
    notifySessionMetadataChanged({ model: 'after-reset' })
    notifyPermissionModeChanged('default' as never)

    expect(stateCalls).toEqual([])
    expect(metadataCalls).toEqual([])
    expect(permCalls).toEqual([])
    expect(sdkCalls).toEqual([])
  })
})

describe('sessionState SDK event consumer (direct push)', () => {
  beforeEach(() => {
    resetSessionStateForTests()
  })

  test('SDK consumer receives session_state_changed events directly', () => {
    const events: Array<{ subtype: string; state: string }> = []
    registerSdkEventConsumer(event => {
      events.push({ subtype: event.subtype, state: event.state })
    })

    notifySessionStateChanged('running')
    notifySessionStateChanged('requires_action')
    notifySessionStateChanged('idle')

    expect(events).toEqual([
      { subtype: 'session_state_changed', state: 'running' },
      { subtype: 'session_state_changed', state: 'requires_action' },
      { subtype: 'session_state_changed', state: 'idle' },
    ])
  })

  test('multiple SDK consumers all receive events', () => {
    const calls: string[] = []
    registerSdkEventConsumer(() => calls.push('C1'))
    registerSdkEventConsumer(() => calls.push('C2'))
    registerSdkEventConsumer(() => calls.push('C3'))

    notifySessionStateChanged('running')

    expect(calls).toEqual(['C1', 'C2', 'C3'])
  })

  test('unsubscribed SDK consumer does not receive subsequent events', () => {
    const calls: string[] = []
    const unsub = registerSdkEventConsumer(() => calls.push('C1'))
    registerSdkEventConsumer(() => calls.push('C2'))

    notifySessionStateChanged('running')
    expect(calls).toEqual(['C1', 'C2'])

    unsub()
    calls.length = 0

    notifySessionStateChanged('idle')
    expect(calls).toEqual(['C2'])
  })

  test('SDK event contains correct shape matching OpenCode format', () => {
    const events: Array<Record<string, unknown>> = []
    registerSdkEventConsumer(event => {
      events.push(event as unknown as Record<string, unknown>)
    })

    notifySessionStateChanged('running')

    expect(events).toEqual([
      {
        type: 'system',
        subtype: 'session_state_changed',
        state: 'running',
      },
    ])
  })

  test('SDK consumer works independently of state listeners', () => {
    const stateCalls: string[] = []
    const sdkCalls: string[] = []

    setSessionStateChangedListener(() => stateCalls.push('state'))
    registerSdkEventConsumer(() => sdkCalls.push('sdk'))

    notifySessionStateChanged('running')

    expect(stateCalls).toEqual(['state'])
    expect(sdkCalls).toEqual(['sdk'])
  })

  test('SDK consumer is NOT called when only metadata changes', () => {
    const sdkCalls: string[] = []
    registerSdkEventConsumer(() => sdkCalls.push('sdk'))

    notifySessionMetadataChanged({ model: 'sonnet-4' })
    notifyPermissionModeChanged('plan' as never)
    notifyAutomationStateChanged({ enabled: true, phase: 'standby', next_tick_at: 100, sleep_until: null })

    expect(sdkCalls).toEqual([])
  })
})
