import { describe, expect, test } from 'bun:test'
import { decomposeMessageToParts, type SessionMessage } from '../transcriptReader.js'

describe('decomposeMessageToParts', () => {
  test('assistant with content blocks produces parts', () => {
    const msg: SessionMessage = {
      uuid: 'msg-1',
      type: 'assistant',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'thinking', thinking: 'Let me think...' },
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
      ],
      timestamp: Date.now(),
      parent_uuid: null,
    }

    const result = decomposeMessageToParts(msg)
    expect(result.parts).toBeDefined()
    expect(result.parts!.length).toBe(3)
    expect(result.parts![0].type).toBe('text')
    expect(result.parts![1].type).toBe('reasoning')
    expect(result.parts![2].type).toBe('tool')
    const toolPart = result.parts![2] as { tool: string; callID: string }
    expect(toolPart.tool).toBe('bash')
    expect(toolPart.callID).toBe('tool-1')
  })

  test('assistant with redacted_thinking produces reasoning part', () => {
    const msg: SessionMessage = {
      uuid: 'msg-1',
      type: 'assistant',
      role: 'assistant',
      content: [{ type: 'redacted_thinking' }],
      timestamp: Date.now(),
      parent_uuid: null,
    }

    const result = decomposeMessageToParts(msg)
    expect(result.parts!.length).toBe(1)
    const p = result.parts![0] as { redacted?: boolean }
    expect(p.redacted).toBe(true)
  })

  test('user with tool_result content produces tool-result part', () => {
    const msg: SessionMessage = {
      uuid: 'msg-1',
      type: 'user',
      role: 'user',
      content: [
        { type: 'text', text: 'Here is the result' },
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' },
      ],
      timestamp: Date.now(),
      parent_uuid: null,
    }

    const result = decomposeMessageToParts(msg)
    expect(result.parts!.length).toBe(2)
    expect(result.parts![0].type).toBe('text')
    expect(result.parts![1].type).toBe('tool-result')
  })

  test('message without array content returns unchanged', () => {
    const msg: SessionMessage = {
      uuid: 'msg-1',
      type: 'assistant',
      role: 'assistant',
      content: 'plain text',
      timestamp: Date.now(),
      parent_uuid: null,
    }

    const result = decomposeMessageToParts(msg)
    expect(result.parts).toBeUndefined()
  })

  test('message with existing parts returns unchanged', () => {
    const msg: SessionMessage = {
      uuid: 'msg-1',
      type: 'assistant',
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      parent_uuid: null,
      parts: [{ type: 'text', id: 'p-1', text: 'existing' }],
    }

    const result = decomposeMessageToParts(msg)
    expect(result.parts!.length).toBe(1)
  })

  test('system message returns unchanged', () => {
    const msg: SessionMessage = {
      uuid: 'msg-1',
      type: 'system',
      role: 'system',
      content: 'some info',
      timestamp: Date.now(),
      parent_uuid: null,
    }

    const result = decomposeMessageToParts(msg)
    expect(result.parts).toBeUndefined()
  })

  test('tool name normalization: Write → edit, Agent → task', () => {
    const msg: SessionMessage = {
      uuid: 'msg-1',
      type: 'assistant',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/test.ts' } },
        { type: 'tool_use', id: 't2', name: 'Agent', input: { prompt: 'do stuff' } },
      ],
      timestamp: Date.now(),
      parent_uuid: null,
    }

    const result = decomposeMessageToParts(msg)
    const tool1 = result.parts![0] as { tool: string }
    const tool2 = result.parts![1] as { tool: string }
    expect(tool1.tool).toBe('edit')
    expect(tool2.tool).toBe('task')
  })
})
