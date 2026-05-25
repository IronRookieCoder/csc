import { describe, expect, test } from 'bun:test'
import {
  deriveActivityRailState,
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

function toolResult(uuid: string, id: string, content = 'ok', isError = false): any {
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
      userText('u1', '修复登录超时提示'),
      toolUse('a1', 'toolu_read', 'Read', { file_path: 'src/login.ts' }),
      toolResult('u2', 'toolu_read', 'file content'),
      assistantText('a2', '我已定位问题。'),
    ]

    const result = derive({ messages })

    expect(result.chatMessages.map(message => String(message.uuid))).toEqual(['u1', 'a2'])
    expect(messages.map(message => message.uuid)).toEqual(['u1', 'a1', 'u2', 'a2'])
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
      message: '权限提示',
    }

    const result = derive({ messages: [toolUse('a0', 'toolu_1', 'Bash'), apiError, warning] })

    expect(result.chatMessages.map(message => String(message.uuid))).toEqual(['a1', 's1'])
  })

  test('chatMessages hides assistant messages when tool_use is after text content', () => {
    const message: any = {
      ...assistantText('a1', '先说明一下'),
      message: {
        id: 'msg-a1',
        content: [
          { type: 'text', text: '先说明一下' },
          { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: 'src/login.ts' } },
        ],
      },
    }

    const result = derive({ messages: [message, assistantText('a2', '后续说明')] })

    expect(result.chatMessages.map(item => String(item.uuid))).toEqual(['a2'])
  })

  test('chatMessages hides user messages when tool_result is after text content', () => {
    const message: any = {
      ...userText('u1', '先说明一下'),
      message: {
        content: [
          { type: 'text', text: '先说明一下' },
          { type: 'tool_result', tool_use_id: 'toolu_read', content: 'file content', is_error: false },
        ],
      },
    }

    const result = derive({ messages: [message, userText('u2', '继续')] })

    expect(result.chatMessages.map(item => String(item.uuid))).toEqual(['u2'])
  })

  test('chatMessages hides assistant messages when any content block is tool_use', () => {
    const message: any = {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-05-25T00:00:00.000Z',
      message: {
        id: 'msg-a1',
        content: [
          { type: 'text', text: '准备读取' },
          { type: 'text', text: '第二段说明' },
          { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'pwd' } },
          { type: 'text', text: '工具调用之后的内容' },
        ],
      },
    }

    const result = derive({ messages: [assistantText('a0', '保留'), message] })

    expect(result.chatMessages.map(item => String(item.uuid))).toEqual(['a0'])
  })

  test('maps read, edit, and verification tools into rail sections', () => {
    const messages = [
      toolUse('a1', 'toolu_read', 'Read', { file_path: 'src/login.ts' }),
      toolResult('u1', 'toolu_read'),
      toolUse('a2', 'toolu_edit', 'Edit', { file_path: 'src/login.ts' }),
      toolResult('u2', 'toolu_edit', 'updated'),
      toolUse('a3', 'toolu_test', 'Bash', { command: 'bun test src/login.test.ts' }),
      toolResult('u3', 'toolu_test', 'pass'),
    ]

    const result = derive({ messages })

    expect(result.railState.activity.map(item => [item.title, item.status])).toEqual([
      ['读取上下文', 'done'],
      ['准备改动', 'done'],
      ['执行验证', 'done'],
    ])
    expect(result.railState.changes).toEqual([
      {
        filePath: 'src/login.ts',
        diffStat: 'modified',
        status: 'done',
      },
    ])
    expect(result.railState.quality).toContainEqual({
      id: 'impact',
      label: '影响范围',
      status: '需关注',
    })
    expect(result.railState.quality).toContainEqual({
      id: 'verification',
      label: '测试验证',
      status: '通过',
    })
  })

  test('marks in-progress tools as running and later phases as pending', () => {
    const messages = [
      toolUse('a1', 'toolu_read', 'Grep', { pattern: 'timeout' }),
      toolResult('u1', 'toolu_read'),
      toolUse('a2', 'toolu_edit', 'Write', { file_path: 'src/login.ts' }),
    ]

    const result = derive({
      messages,
      inProgressToolUseIDs: new Set(['toolu_edit']),
    })

    expect(result.railState.activity.map(item => [item.title, item.status])).toEqual([
      ['读取上下文', 'done'],
      ['准备改动', 'running'],
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
      label: '测试验证',
      status: '需关注',
    })
  })

  test('unknown bash command does not update verification gate', () => {
    const messages = [
      toolUse('a1', 'toolu_bash', 'Bash', { command: 'ls -la' }),
      toolResult('u1', 'toolu_bash', 'ok'),
    ]

    const result = derive({ messages })

    expect(result.railState.activity).toContainEqual({
      id: 'toolu_bash',
      title: '执行工具：Bash',
      detail: 'ls -la',
      status: 'done',
    })
    expect(result.railState.quality).toContainEqual({
      id: 'verification',
      label: '测试验证',
      status: '待执行',
    })
  })
})
