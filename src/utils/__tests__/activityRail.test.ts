import { describe, expect, test } from 'bun:test'
import {
  deriveActivityRailState,
  hasVisibleConversationContent,
  type ActivityRailInput,
} from '../activityRail'

function assistantText(uuid: string, text: string): any {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-05-25T00:00:00.000Z',
    message: {
      id: `msg-${uuid}`,
      content: [{ type: 'text', text }],
    },
  }
}

function userText(uuid: string, text: string): any {
  return {
    type: 'user',
    uuid,
    timestamp: '2026-05-25T00:00:00.000Z',
    message: {
      content: [{ type: 'text', text }],
    },
  }
}

function toolUse(
  uuid: string,
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): any {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-05-25T00:00:00.000Z',
    message: {
      id: `msg-${uuid}`,
      content: [{ type: 'tool_use', id, name, input }],
    },
  }
}

function toolResult(
  uuid: string,
  id: string,
  content = 'ok',
  isError = false,
): any {
  return {
    type: 'user',
    uuid,
    timestamp: '2026-05-25T00:00:00.000Z',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content,
          is_error: isError,
        },
      ],
    },
  }
}

function derive(input: Partial<ActivityRailInput>) {
  return deriveActivityRailState({
    messages: input.messages ?? [],
    inProgressToolUseIDs: input.inProgressToolUseIDs ?? new Set(),
  })
}

describe('deriveActivityRailState', () => {
  test('default chatMessages hides tool_use and tool_result messages', () => {
    const messages = [
      userText('u1', 'Fix login timeout prompt'),
      toolUse('a1', 'toolu_read', 'Read', { file_path: 'src/login.ts' }),
      toolResult('u2', 'toolu_read', 'file content'),
      assistantText('a2', 'I found the issue.'),
    ]

    const result = derive({ messages })

    expect(result.chatMessages.map(message => String(message.uuid))).toEqual([
      'u1',
      'a2',
    ])
    expect(messages.map(message => message.uuid)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
    ])
  })

  test('chatMessages keeps system warnings and api error assistant messages', () => {
    const apiError: any = {
      ...assistantText('a1', 'API error'),
      isApiErrorMessage: true,
    }
    const warning: any = {
      type: 'system',
      subtype: 'warning',
      uuid: 's1',
      timestamp: '2026-05-25T00:00:00.000Z',
      message: 'Permission notice',
    }

    const result = derive({
      messages: [toolUse('a0', 'toolu_1', 'Bash'), apiError, warning],
    })

    expect(result.chatMessages.map(message => String(message.uuid))).toEqual([
      'a1',
      's1',
    ])
  })

  test('chatMessages keeps assistant text blocks and removes tool_use blocks from mixed messages', () => {
    const message: any = {
      ...assistantText('a1', 'First note'),
      message: {
        id: 'msg-a1',
        content: [
          { type: 'text', text: 'First note' },
          {
            type: 'tool_use',
            id: 'toolu_read',
            name: 'Read',
            input: { file_path: 'src/login.ts' },
          },
        ],
      },
    }

    const result = derive({
      messages: [message, assistantText('a2', 'Follow-up note')],
    })

    expect(result.chatMessages.map(item => String(item.uuid))).toEqual([
      'a1',
      'a2',
    ])
    expect((result.chatMessages[0] as any).message.content).toEqual([
      { type: 'text', text: 'First note' },
    ])
    expect(message.message.content).toHaveLength(2)
  })

  test('chatMessages keeps user text blocks and removes tool_result blocks from mixed messages', () => {
    const message: any = {
      ...userText('u1', 'First note'),
      message: {
        content: [
          { type: 'text', text: 'First note' },
          {
            type: 'tool_result',
            tool_use_id: 'toolu_read',
            content: 'file content',
            is_error: false,
          },
        ],
      },
    }

    const result = derive({ messages: [message, userText('u2', 'Continue')] })

    expect(result.chatMessages.map(item => String(item.uuid))).toEqual([
      'u1',
      'u2',
    ])
    expect((result.chatMessages[0] as any).message.content).toEqual([
      { type: 'text', text: 'First note' },
    ])
    expect(message.message.content).toHaveLength(2)
  })

  test('chatMessages preserves all visible assistant text blocks in mixed messages', () => {
    const message: any = {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-05-25T00:00:00.000Z',
      message: {
        id: 'msg-a1',
        content: [
          { type: 'text', text: 'Preparing to read' },
          { type: 'text', text: 'Second note' },
          {
            type: 'tool_use',
            id: 'toolu_bash',
            name: 'Bash',
            input: { command: 'pwd' },
          },
          { type: 'text', text: 'Text after tool call' },
        ],
      },
    }

    const result = derive({ messages: [assistantText('a0', 'Keep this'), message] })

    expect(result.chatMessages.map(item => String(item.uuid))).toEqual([
      'a0',
      'a1',
    ])
    expect((result.chatMessages[1] as any).message.content).toEqual([
      { type: 'text', text: 'Preparing to read' },
      { type: 'text', text: 'Second note' },
      { type: 'text', text: 'Text after tool call' },
    ])
    expect(message.message.content).toHaveLength(4)
  })

  test('maps edit and verification tools into change set and quality gate only', () => {
    const messages = [
      toolUse('a1', 'toolu_read', 'Read', { file_path: 'src/login.ts' }),
      toolResult('u1', 'toolu_read'),
      toolUse('a2', 'toolu_edit', 'Edit', { file_path: 'src/login.ts' }),
      toolResult('u2', 'toolu_edit', 'updated'),
      toolUse('a3', 'toolu_test', 'Bash', {
        command: 'bun test src/login.test.ts',
      }),
      toolResult('u3', 'toolu_test', 'pass'),
    ]

    const result = derive({ messages })

    expect(Object.keys(result.railState)).toEqual(['changes', 'quality'])
    expect(result.railState.changes).toEqual([
      {
        filePath: 'src/login.ts',
        diffStat: 'modified',
        status: 'done',
      },
    ])
    expect(result.railState.quality).toContainEqual({
      id: 'impact',
      label: 'Impact',
      status: 'attention',
    })
    expect(result.railState.quality).toContainEqual({
      id: 'verification',
      label: 'Verification',
      status: 'passed',
    })
  })

  test('marks in-progress edit tools as running without read activity', () => {
    const messages = [
      toolUse('a1', 'toolu_read', 'Grep', { pattern: 'timeout' }),
      toolResult('u1', 'toolu_read'),
      toolUse('a2', 'toolu_glob', 'Glob', { pattern: '**/*.ts' }),
      toolResult('u2', 'toolu_glob'),
      toolUse('a3', 'toolu_edit', 'Write', { file_path: 'src/login.ts' }),
    ]

    const result = derive({
      messages,
      inProgressToolUseIDs: new Set(['toolu_edit']),
    })

    expect(Object.keys(result.railState)).toEqual(['changes', 'quality'])
    expect(result.railState.changes).toEqual([
      {
        filePath: 'src/login.ts',
        diffStat: 'modified',
        status: 'running',
      },
    ])
  })

  test('narrowSummary reports changed files and pending tests', () => {
    const messages = [
      toolUse('a1', 'toolu_read', 'Read', { file_path: 'src/login.ts' }),
      toolResult('u1', 'toolu_read'),
      toolUse('a2', 'toolu_edit', 'Edit', { file_path: 'src/login.ts' }),
    ]

    const result = derive({
      messages,
      inProgressToolUseIDs: new Set(['toolu_edit']),
    })

    expect(result.narrowSummary).toBe('Changes: 1 file changed | tests pending')
  })

  test('narrowSummary reports plural files, attention changes, and passed tests', () => {
    const messages = [
      toolUse('a1', 'toolu_write', 'Write', { file_path: 'src/login.ts' }),
      toolResult('u1', 'toolu_write', 'failed', true),
      toolUse('a2', 'toolu_edit', 'Edit', { file_path: 'src/config.ts' }),
      toolResult('u2', 'toolu_edit', 'updated'),
      toolUse('a3', 'toolu_test', 'Bash', {
        command: 'bun test src/login.test.ts',
      }),
      toolResult('u3', 'toolu_test', 'pass'),
    ]

    const result = derive({ messages })

    expect(result.narrowSummary).toBe(
      'Changes: 2 files changed, 1 attention | tests passed',
    )
  })

  test('narrowSummary reports attention tests', () => {
    const messages = [
      toolUse('a1', 'toolu_test', 'Bash', { command: 'bun run typecheck' }),
      toolResult('u1', 'toolu_test', 'failed', true),
    ]

    const result = derive({ messages })

    expect(result.narrowSummary).toBe(
      'Changes: 0 files changed | tests attention',
    )
  })

  test('keeps assistant messages that include visible text even when other turns use tools', () => {
    const messages = [
      toolUse('a1', 'toolu_read', 'Read', { file_path: 'src/login.ts' }),
      toolResult('u1', 'toolu_read'),
      assistantText('a2', 'Read complete, next edit.'),
    ]

    const result = derive({ messages })

    expect(result.chatMessages.map(message => String(message.uuid))).toEqual([
      'a2',
    ])
  })

  test('failed verification command marks quality gate as attention', () => {
    const messages = [
      toolUse('a1', 'toolu_test', 'Bash', { command: 'bun run typecheck' }),
      toolResult('u1', 'toolu_test', 'tsc failed', true),
    ]

    const result = derive({ messages })

    expect(result.railState.quality).toContainEqual({
      id: 'verification',
      label: 'Verification',
      status: 'attention',
    })
  })

  test('unknown bash command does not update verification gate', () => {
    const messages = [
      toolUse('a1', 'toolu_bash', 'Bash', { command: 'ls -la' }),
      toolResult('u1', 'toolu_bash', 'ok'),
    ]

    const result = derive({ messages })

    expect(Object.keys(result.railState)).toEqual(['changes', 'quality'])
    expect(result.railState.changes).toEqual([])
    expect(result.railState.quality).toContainEqual({
      id: 'verification',
      label: 'Verification',
      status: 'pending',
    })
  })

  test('failed verification is not overwritten by later successful verification', () => {
    const messages = [
      toolUse('a1', 'toolu_typecheck', 'Bash', {
        command: 'bun run typecheck',
      }),
      toolResult('u1', 'toolu_typecheck', 'tsc failed', true),
      toolUse('a2', 'toolu_test', 'Bash', {
        command: 'bun test src/login.test.ts',
      }),
      toolResult('u2', 'toolu_test', 'pass'),
    ]

    const result = derive({ messages })

    expect(Object.keys(result.railState)).toEqual(['changes', 'quality'])
    expect(result.railState.quality).toContainEqual({
      id: 'verification',
      label: 'Verification',
      status: 'attention',
    })
  })

  test('completed tool results take precedence over stale in-progress ids', () => {
    const messages = [
      toolUse('a1', 'toolu_done', 'Read', { file_path: 'src/login.ts' }),
      toolResult('u1', 'toolu_done'),
      toolUse('a2', 'toolu_failed', 'Bash', { command: 'bun run typecheck' }),
      toolResult('u2', 'toolu_failed', 'tsc failed', true),
    ]

    const result = derive({
      messages,
      inProgressToolUseIDs: new Set(['toolu_done', 'toolu_failed']),
    })

    expect(Object.keys(result.railState)).toEqual(['changes', 'quality'])
    expect(result.railState.quality).toContainEqual({
      id: 'verification',
      label: 'Verification',
      status: 'attention',
    })
  })

  test('same file edit keeps attention status after later successful edit', () => {
    const messages = [
      toolUse('a1', 'toolu_write', 'Write', { file_path: 'src/login.ts' }),
      toolResult('u1', 'toolu_write', 'write failed', true),
      toolUse('a2', 'toolu_edit', 'Edit', { file_path: 'src/login.ts' }),
      toolResult('u2', 'toolu_edit', 'updated'),
    ]

    const result = derive({ messages })

    expect(Object.keys(result.railState)).toEqual(['changes', 'quality'])
    expect(result.railState.changes).toEqual([
      {
        filePath: 'src/login.ts',
        diffStat: 'modified',
        status: 'attention',
      },
    ])
  })
})

describe('hasVisibleConversationContent', () => {
  test('returns false for empty and tool-only messages', () => {
    expect(hasVisibleConversationContent([] as any)).toBe(false)
    expect(
      hasVisibleConversationContent([
        toolUse('a1', 'toolu_read', 'Read', { file_path: 'src/login.ts' }),
        toolResult('u1', 'toolu_read'),
      ] as any),
    ).toBe(false)
  })

  test('returns false for meta user messages', () => {
    expect(
      hasVisibleConversationContent([
        {
          ...userText('u1', 'background notification'),
          isMeta: true,
        },
      ] as any),
    ).toBe(false)
  })

  test('returns false for startup system messages without user or assistant text', () => {
    expect(
      hasVisibleConversationContent([
        {
          type: 'system',
          subtype: 'init',
          uuid: 's1',
          timestamp: '2026-05-25T00:00:00.000Z',
          message: 'Initialized session',
        },
      ] as any),
    ).toBe(false)
  })

  test('returns true for real user or assistant text messages', () => {
    expect(hasVisibleConversationContent([userText('u1', 'hello')] as any)).toBe(true)
    expect(
      hasVisibleConversationContent([assistantText('a1', 'I can help.')] as any),
    ).toBe(true)
  })
})
