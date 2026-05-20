import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { resetStateForTests } from '../bootstrap/state'
import { query } from '../query'
import { buildTool, getEmptyToolPermissionContext } from '../Tool'
import type { AssistantMessage, Message, UserMessage } from '../types/message'
import { createUserMessage } from '../utils/messages'
import { asSystemPrompt } from '../utils/systemPromptType'
import { lazySchema } from '../utils/lazySchema'
import { z } from 'zod/v4'

let mockAPIProvider = 'firstParty'

mock.module('../utils/model/providers.js', () => ({
  getAPIProvider: () => mockAPIProvider,
}))

beforeEach(() => {
  resetStateForTests()
  mockAPIProvider = 'firstParty'
})

function createToolUseContext(): any {
  let appState = {
    toolPermissionContext: getEmptyToolPermissionContext(),
    fastMode: false,
    mcp: {
      tools: [],
      clients: [],
    },
    effortValue: undefined,
    advisorModel: undefined,
    sessionHooks: new Map(),
  }

  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-5-20250929',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: {
        activeAgents: [],
        allowedAgentTypes: [],
      },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => appState,
    setAppState: (updater: (state: any) => any) => {
      appState = updater(appState as never)
    },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as any
}

const updateTodoListTool = buildTool({
  name: 'update_todo_list',
  maxResultSizeChars: 1000,
  async description() {
    return 'Update todo list'
  },
  async prompt() {
    return 'Update todo list'
  },
  get inputSchema() {
    return lazySchema(() => z.object({ todos: z.string() }))()
  },
  isConcurrencySafe() {
    return false
  },
  async call() {
    return { data: {} }
  },
  renderToolUseMessage() {
    return null
  },
  mapToolResultToToolResultBlockParam(_content, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: 'ok',
    }
  },
})

function createAssistantMessage(
  content: Array<{ type: 'text'; text: string }>,
  stopReason: 'end_turn' | 'tool_use',
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: `msg_${stopReason}`,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content,
    },
  } as unknown as AssistantMessage
}

function createTaskCreateAssistantMessage(): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: 'msg_task_create',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [
        {
          type: 'tool_use',
          id: 'toolu_task_create',
          name: 'TaskCreate',
          input: {
            subject: '测试任务',
            description: '测试任务',
          },
        },
      ],
    },
  } as unknown as AssistantMessage
}

function createTaskCreateResultMessage(
  assistantMessage: AssistantMessage,
): UserMessage {
  return createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_task_create',
        content: 'Task #1 created successfully: 测试任务',
      },
    ],
    toolUseResult: { task: { id: '1', subject: '测试任务' } },
    sourceToolAssistantUUID: assistantMessage.uuid,
  })
}

function createTaskFlowMessages(): Message[] {
  const assistant = createTaskCreateAssistantMessage()
  return [
    createUserMessage({ content: '使用任务列表跟踪并标记完成' }),
    assistant,
    createTaskCreateResultMessage(assistant),
  ]
}

describe('query missing tool_use recovery', () => {
  test('continues once when provider reports tool_use without a tool_use block', async () => {
    const toolUseContext = createToolUseContext()

    let callCount = 0
    const observedPrompts: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        callCount += 1
        observedPrompts.push(messages)
        if (callCount === 1) {
          yield createAssistantMessage(
            [{ type: 'text', text: '现在调用工具继续处理。' }],
            'tool_use',
          )
          return
        }
        yield createAssistantMessage(
          [{ type: 'text', text: '已继续处理。' }],
          'end_turn',
        )
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: '创建一个任务列表，并标记任务状态为完成',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 3,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    expect(next.value.reason).toBe('completed')
    expect(callCount).toBe(2)
    expect(JSON.stringify(observedPrompts[1])).toContain(
      'Your previous response ended with stop_reason=tool_use',
    )
  })

  test('retries once for missing task tool use', async () => {
    const toolUseContext = createToolUseContext()

    let callCount = 0
    const observedPrompts: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        callCount += 1
        observedPrompts.push(messages)
        yield createAssistantMessage(
          [
            {
              type: 'text',
              text:
                callCount === 1
                  ? '现在让我查看任务列表，然后更新它们的状态。'
                  : '任务状态已更新完成。',
            },
          ],
          callCount === 1 ? 'tool_use' : 'end_turn',
        )
      },
    }

    const generator = query({
      messages: createTaskFlowMessages(),
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 3,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    expect(next.value.reason).toBe('completed')
    expect(callCount).toBe(2)
    expect(JSON.stringify(observedPrompts[1])).toContain(
      'Continue by issuing the missing tool call now',
    )
  })

  test('nudges CoStrict task recovery toward update_todo_list', async () => {
    mockAPIProvider = 'costrict'
    const toolUseContext = createToolUseContext()

    let callCount = 0
    const observedPrompts: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        callCount += 1
        observedPrompts.push(messages)
        yield createAssistantMessage(
          [
            {
              type: 'text',
              text:
                callCount === 1
                  ? '现在让我查看任务列表，然后更新它们的状态。'
                  : '任务状态已更新完成。',
            },
          ],
          callCount === 1 ? 'tool_use' : 'end_turn',
        )
      },
    }

    const generator = query({
      messages: createTaskFlowMessages(),
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 3,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    expect(next.value.reason).toBe('completed')
    expect(callCount).toBe(2)
    expect(JSON.stringify(observedPrompts[1])).toContain('update_todo_list')
    expect(JSON.stringify(observedPrompts[1])).toContain(
      'complete markdown checklist',
    )
  })

  test('nudges task recovery toward update_todo_list when the tool is available', async () => {
    const toolUseContext = createToolUseContext()
    toolUseContext.options.tools = [updateTodoListTool]

    let callCount = 0
    const observedPrompts: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* ({ messages }: { messages: unknown[] }) {
        callCount += 1
        observedPrompts.push(messages)
        yield createAssistantMessage(
          [
            {
              type: 'text',
              text:
                callCount === 1
                  ? '任务已创建。现在让我查看任务列表并更新状态。'
                  : '任务状态已更新完成。',
            },
          ],
          callCount === 1 ? 'tool_use' : 'end_turn',
        )
      },
    }

    const generator = query({
      messages: createTaskFlowMessages(),
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 3,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      next = await generator.next()
    }

    expect(next.value.reason).toBe('completed')
    expect(callCount).toBe(2)
    expect(JSON.stringify(observedPrompts[1])).toContain('update_todo_list')
  })

  test('surfaces a task-specific error when missing task tool use recovery fails', async () => {
    const toolUseContext = createToolUseContext()

    let callCount = 0
    const yielded: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* () {
        callCount += 1
        yield createAssistantMessage(
          [{ type: 'text', text: '让我查看任务列表确认状态更新成功：' }],
          'tool_use',
        )
      },
    }

    const generator = query({
      messages: createTaskFlowMessages(),
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 3,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      yielded.push(next.value)
      next = await generator.next()
    }

    expect(next.value.reason).toBe('model_error')
    expect(callCount).toBe(2)
    expect(JSON.stringify(yielded)).toContain(
      'Task tool call failed: the model ended with stop_reason=tool_use',
    )
  })

  test('surfaces an error when generic missing tool_use recovery fails', async () => {
    const toolUseContext = createToolUseContext()

    let callCount = 0
    const yielded: unknown[] = []
    const deps = {
      uuid: () => 'query-chain-id',
      microcompact: async (messages: unknown[]) => ({ messages }),
      autocompact: async () => ({
        compactionResult: undefined,
        consecutiveFailures: 0,
      }),
      callModel: async function* () {
        callCount += 1
        yield createAssistantMessage(
          [{ type: 'text', text: '现在调用工具继续处理。' }],
          'tool_use',
        )
      },
    }

    const generator = query({
      messages: [
        createUserMessage({
          content: '使用工具继续处理',
        }),
      ],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 3,
      deps: deps as never,
    })

    let next = await generator.next()
    while (!next.done) {
      yielded.push(next.value)
      next = await generator.next()
    }

    expect(next.value.reason).toBe('model_error')
    expect(callCount).toBe(2)
    expect(JSON.stringify(yielded)).toContain(
      'Model response error: the model indicated it wanted to call a tool',
    )
  })
})
