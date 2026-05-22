import { describe, expect, test, beforeEach } from 'bun:test'
import { processStreamEvent, resetAllState } from '../streamStateTracker.js'

describe('processStreamEvent', () => {
  const sessionID = 'test-session-1'

  beforeEach(() => {
    resetAllState(sessionID)
  })

  test('message_start emits message.updated + step-start', () => {
    const events = processStreamEvent(sessionID, {
      type: 'message_start',
      message: {
        id: 'msg-1',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
      },
    })

    expect(events.length).toBe(2)
    expect(events[0].type).toBe('message.updated')
    expect(events[0].properties).toMatchObject({
      sessionID,
      info: { role: 'assistant', modelID: 'claude-sonnet-4-20250514' },
    })
    expect(events[1].type).toBe('message.part.updated')
    expect(events[1].properties).toMatchObject({
      sessionID,
      part: { type: 'step-start' },
    })
  })

  test('content_block_start (text) emits text part', () => {
    const events = processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })

    expect(events.length).toBe(1)
    expect(events[0].type).toBe('message.part.updated')
    expect(events[0].properties.part).toMatchObject({ type: 'text', text: '' })
  })

  test('content_block_start (thinking) emits reasoning part', () => {
    const events = processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    })

    expect(events.length).toBe(1)
    expect(events[0].properties.part).toMatchObject({ type: 'reasoning', redacted: false })
  })

  test('content_block_start (redacted_thinking) emits reasoning part with redacted=true', () => {
    const events = processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'redacted_thinking' },
    })

    expect(events.length).toBe(1)
    expect(events[0].properties.part).toMatchObject({ type: 'reasoning', redacted: true })
  })

  test('content_block_start (tool_use) emits pending tool part', () => {
    const events = processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool-1', name: 'Bash' },
    })

    expect(events.length).toBe(1)
    expect(events[0].properties.part).toMatchObject({
      type: 'tool',
      callID: 'tool-1',
      tool: 'bash',
      state: { status: 'pending', input: {} },
    })
  })

  test('content_block_delta (text_delta) emits part delta', () => {
    processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })

    const events = processStreamEvent(sessionID, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    })

    expect(events.length).toBe(1)
    expect(events[0].type).toBe('message.part.delta')
    expect(events[0].properties).toMatchObject({ field: 'text', delta: 'Hello' })
  })

  test('content_block_delta (thinking_delta) emits part delta', () => {
    processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    })

    const events = processStreamEvent(sessionID, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Let me think...' },
    })

    expect(events[0].properties).toMatchObject({ field: 'text', delta: 'Let me think...' })
  })

  test('content_block_delta (input_json_delta) accumulates internally without emitting delta event', () => {
    processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool-1', name: 'Bash' },
    })

    const events1 = processStreamEvent(sessionID, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":"ls' },
    })
    expect(events1.length).toBe(0)

    const events2 = processStreamEvent(sessionID, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"}' },
    })
    expect(events2.length).toBe(0)
  })

  test('content_block_stop (tool_use) emits running state with parsed input', () => {
    processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool-1', name: 'Read' },
    })
    processStreamEvent(sessionID, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"file_path":"/test.ts"}' },
    })

    const events = processStreamEvent(sessionID, {
      type: 'content_block_stop',
      index: 0,
    })

    expect(events.length).toBe(1)
    expect((events[0].properties.part as Record<string, unknown>)?.state).toMatchObject({
      status: 'running',
      input: { filePath: '/test.ts' },
    })
  })

  test('content_block_stop (tool_use) handles corrupted JSON gracefully', () => {
    processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool-1', name: 'Bash' },
    })
    processStreamEvent(sessionID, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{broken' },
    })

    const events = processStreamEvent(sessionID, {
      type: 'content_block_stop',
      index: 0,
    })

    expect((events[0].properties.part as Record<string, unknown>)?.state).toMatchObject({ input: {} })
  })

  test('content_block_stop (text) emits part with text and time.end', () => {
    processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })
    processStreamEvent(sessionID, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    })

    const events = processStreamEvent(sessionID, {
      type: 'content_block_stop',
      index: 0,
    })

    expect(events.length).toBe(1)
    expect(events[0].type).toBe('message.part.updated')
    const part = events[0].properties.part as Record<string, unknown>
    expect(part.type).toBe('text')
    expect(part.text).toBe('hello')
    expect((part.time as Record<string, unknown>).end).toBeDefined()
  })

  test('message_delta extracts usage and stopReason (no event emitted)', () => {
    const events = processStreamEvent(sessionID, {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 42 },
    })

    expect(events.length).toBe(0)
  })

  test('message_stop emits step-finish with tokens', () => {
    processStreamEvent(sessionID, {
      type: 'message_start',
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
      },
    })
    processStreamEvent(sessionID, {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 42 },
    })

    const events = processStreamEvent(sessionID, { type: 'message_stop' })

    expect(events.length).toBe(2)
    expect(events[0].type).toBe('message.part.updated')
    expect(events[0].properties.part).toMatchObject({
      type: 'step-finish',
      reason: 'end_turn',
      tokens: {
        input: 100,
        output: 42,
        reasoning: 0,
        cache: { read: 50, write: 10 },
      },
    })
    expect(events[1].type).toBe('message.updated')
    expect((events[1].properties.info as Record<string, unknown>).time).toMatchObject({ completed: expect.any(Number) })
  })

  test('full text flow: start → delta → stop → message_delta → message_stop', () => {
    const allEvents: Array<{ type: string; properties: Record<string, unknown> }> = []

    const collect = (evts: Array<{ type: string; properties: Record<string, unknown> }>) => {
      allEvents.push(...evts)
    }

    collect(processStreamEvent(sessionID, {
      type: 'message_start',
      message: { model: 'test-model', usage: { input_tokens: 10 } },
    }))
    collect(processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }))
    collect(processStreamEvent(sessionID, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello ' },
    }))
    collect(processStreamEvent(sessionID, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'world' },
    }))
    collect(processStreamEvent(sessionID, {
      type: 'content_block_stop',
      index: 0,
    }))
    collect(processStreamEvent(sessionID, {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 5 },
    }))
    collect(processStreamEvent(sessionID, { type: 'message_stop' }))

    const types = allEvents.map(e => e.type)
    expect(types).toEqual([
      'message.updated',
      'message.part.updated',
      'message.part.updated',
      'message.part.delta',
      'message.part.delta',
      'message.part.updated',
      'message.part.updated',
      'message.updated',
    ])

    const deltas = allEvents.filter(e => e.type === 'message.part.delta') as Array<{ type: string; properties: Record<string, unknown> }>
    expect(deltas[0].properties.delta).toBe('Hello ')
    expect(deltas[1].properties.delta).toBe('world')
  })

  test('multi-step (tool loop): second message_start creates new step', () => {
    processStreamEvent(sessionID, { type: 'message_stop' })

    const events = processStreamEvent(sessionID, {
      type: 'message_start',
      message: { model: 'test', usage: { input_tokens: 50 } },
    })

    const stepStarts = events.filter(e =>
      e.type === 'message.part.updated' &&
      (e.properties.part as Record<string, unknown>)?.type === 'step-start',
    )
    expect(stepStarts.length).toBe(1)
  })

  test('unknown event type returns empty array', () => {
    const events = processStreamEvent(sessionID, { type: 'ping' })
    expect(events).toEqual([])
  })

  test('content_block_delta with missing block state returns empty', () => {
    const events = processStreamEvent(sessionID, {
      type: 'content_block_delta',
      index: 99,
      delta: { type: 'text_delta', text: 'orphan' },
    })
    expect(events).toEqual([])
  })

  test('content_block_start with no content_block returns empty', () => {
    const events = processStreamEvent(sessionID, {
      type: 'content_block_start',
      index: 0,
    })
    expect(events).toEqual([])
  })
})
