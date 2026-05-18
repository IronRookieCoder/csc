import { beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { resetStateForTests } from '../bootstrap/state'
import { query } from '../query'
import { getEmptyToolPermissionContext } from '../Tool'
import type { AssistantMessage } from '../types/message'
import { createUserMessage } from '../utils/messages'
import { asSystemPrompt } from '../utils/systemPromptType'

beforeEach(() => {
  resetStateForTests()
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

  test('surfaces an error immediately for missing task tool use', async () => {
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
      messages: [
        createUserMessage({
          content: '使用 TaskUpdate 更新任务状态',
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
    expect(callCount).toBe(1)
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
