import { describe, expect, test } from 'bun:test'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { filterEmptyInvalidToolUseMessages } from '../emptyInvalidToolUseFilter.js'
import type { AssistantMessage } from '../../../types/message.js'
import type { ToolUseContext } from '../../../Tool.js'

function makeTool(name: string, acceptsEmpty: boolean) {
  return {
    name,
    inputSchema: {
      safeParse: (input: Record<string, unknown>) => ({
        success:
          acceptsEmpty ||
          (typeof input.file_path === 'string' &&
            typeof input.old_string === 'string' &&
            typeof input.new_string === 'string'),
        data: input,
        error: { message: 'invalid' },
      }),
    },
  }
}

function makeContext(tools: unknown[]): ToolUseContext {
  const abortController = new AbortController()
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { builtinAgents: [], customAgents: [] },
    },
    abortController,
    readFileState: {} as any,
    getAppState: () => ({}) as any,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
}

function makeAssistantMessage(content: ToolUseBlock[]): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-000000000000',
    timestamp: new Date().toISOString(),
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content,
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as AssistantMessage
}

describe('filterEmptyInvalidToolUseMessages', () => {
  test('drops empty invalid tool-use blocks before execution', async () => {
    const editTool = makeTool('Edit', false)
    const emptyEdit = {
      type: 'tool_use',
      id: 'empty-edit',
      name: 'Edit',
      input: {},
    } as ToolUseBlock
    const validEdit = {
      type: 'tool_use',
      id: 'valid-edit',
      name: 'Edit',
      input: {
        file_path: '/tmp/a',
        old_string: 'a',
        new_string: 'b',
      },
    } as ToolUseBlock
    const assistantMessage = makeAssistantMessage([emptyEdit, validEdit])

    const filtered = filterEmptyInvalidToolUseMessages(
      [emptyEdit, validEdit],
      [assistantMessage],
      makeContext([editTool]),
    )

    expect(filtered).toEqual([validEdit])
    expect(assistantMessage.message.content).toEqual([validEdit])
  })

  test('keeps empty tool-use blocks for tools that accept empty input', async () => {
    const taskListTool = makeTool('TaskList', true)
    const taskList = {
      type: 'tool_use',
      id: 'task-list',
      name: 'TaskList',
      input: {},
    } as ToolUseBlock
    const assistantMessage = makeAssistantMessage([taskList])

    const filtered = filterEmptyInvalidToolUseMessages(
      [taskList],
      [assistantMessage],
      makeContext([taskListTool]),
    )

    expect(filtered).toEqual([taskList])
    expect(assistantMessage.message.content).toEqual([taskList])
  })

  test('drops stringified empty invalid tool-use inputs', async () => {
    const editTool = makeTool('Edit', false)
    const emptyEdit = {
      type: 'tool_use',
      id: 'empty-edit',
      name: 'Edit',
      input: '{}',
    } as unknown as ToolUseBlock
    const validEdit = {
      type: 'tool_use',
      id: 'valid-edit',
      name: 'Edit',
      input: {
        file_path: '/tmp/a',
        old_string: 'a',
        new_string: 'b',
      },
    } as ToolUseBlock
    const assistantMessage = makeAssistantMessage([emptyEdit, validEdit])

    const filtered = filterEmptyInvalidToolUseMessages(
      [emptyEdit, validEdit],
      [assistantMessage],
      makeContext([editTool]),
    )

    expect(filtered).toEqual([validEdit])
    expect(assistantMessage.message.content).toEqual([validEdit])
  })

  test('drops empty TaskUpdate calls while preserving valid TaskUpdate input', async () => {
    const taskUpdateTool = {
      name: 'TaskUpdate',
      inputSchema: {
        safeParse: (input: Record<string, unknown>) => ({
          success: typeof input.taskId === 'string',
        }),
      },
    }
    const emptyTaskUpdate = {
      type: 'tool_use',
      id: 'empty-task-update',
      name: 'TaskUpdate',
      input: {},
    } as ToolUseBlock
    const validTaskUpdate = {
      type: 'tool_use',
      id: 'valid-task-update',
      name: 'TaskUpdate',
      input: {
        taskId: '1',
        status: 'completed',
      },
    } as ToolUseBlock
    const assistantMessage = makeAssistantMessage([
      emptyTaskUpdate,
      validTaskUpdate,
    ])

    const filtered = filterEmptyInvalidToolUseMessages(
      [emptyTaskUpdate, validTaskUpdate],
      [assistantMessage],
      makeContext([taskUpdateTool]),
    )

    expect(filtered).toEqual([validTaskUpdate])
    expect(assistantMessage.message.content).toEqual([validTaskUpdate])
  })

  test('keeps a lone empty invalid tool-use block so validation can report it', async () => {
    const taskUpdateTool = {
      name: 'TaskUpdate',
      inputSchema: {
        safeParse: (input: Record<string, unknown>) => ({
          success: typeof input.taskId === 'string',
        }),
      },
    }
    const emptyTaskUpdate = {
      type: 'tool_use',
      id: 'empty-task-update',
      name: 'TaskUpdate',
      input: {},
    } as ToolUseBlock
    const assistantMessage = makeAssistantMessage([emptyTaskUpdate])

    const filtered = filterEmptyInvalidToolUseMessages(
      [emptyTaskUpdate],
      [assistantMessage],
      makeContext([taskUpdateTool]),
    )

    expect(filtered).toEqual([emptyTaskUpdate])
    expect(assistantMessage.message.content).toEqual([emptyTaskUpdate])
  })
})
