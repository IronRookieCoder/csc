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
})
