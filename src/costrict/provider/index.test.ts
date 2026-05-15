import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { AssistantMessage, StreamEvent } from '../../types/message.js'

function makeMessageStart(
  overrides: Record<string, any> = {},
): BetaRawMessageStreamEvent {
  return {
    type: 'message_start',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'test-model',
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      ...overrides,
    },
  } as any
}

function makeContentBlockStart(
  index: number,
  type: 'text' | 'thinking' | 'tool_use',
  extra: Record<string, any> = {},
): BetaRawMessageStreamEvent {
  const block =
    type === 'text'
      ? { type: 'text', text: '' }
      : type === 'thinking'
        ? { type: 'thinking', thinking: '', signature: '' }
        : {
            type: 'tool_use',
            id: `toolu_${index}`,
            name: 'TaskUpdate',
            input: {},
          }

  return {
    type: 'content_block_start',
    index,
    content_block: { ...block, ...extra },
  } as any
}

function makeTextDelta(index: number, text: string): BetaRawMessageStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  } as any
}

function makeThinkingDelta(
  index: number,
  thinking: string,
): BetaRawMessageStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'thinking_delta', thinking },
  } as any
}

function makeInputJsonDelta(
  index: number,
  partialJson: string,
): BetaRawMessageStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partialJson },
  } as any
}

function makeContentBlockStop(index: number): BetaRawMessageStreamEvent {
  return { type: 'content_block_stop', index } as any
}

function makeMessageDelta(
  stopReason: string,
  outputTokens: number,
): BetaRawMessageStreamEvent {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  } as any
}

function makeMessageStop(): BetaRawMessageStreamEvent {
  return { type: 'message_stop' } as any
}

async function* eventStream(events: BetaRawMessageStreamEvent[]) {
  for (const event of events) yield event
}

let _nextEvents: BetaRawMessageStreamEvent[] = []
let _lastCreateArgs: Record<string, any> | null = null
let _mockModelMaxTokens: number | undefined

mock.module('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: async (args: Record<string, any>) => {
          _lastCreateArgs = args
          return { [Symbol.asyncIterator]: async function* () {} }
        },
      },
    }
  },
}))

mock.module('@ant/model-provider', () => ({
  anthropicMessagesToOpenAI: () => [],
  anthropicToolsToOpenAI: () => [],
  anthropicToolChoiceToOpenAI: () => undefined,
  adaptOpenAIStreamToAnthropic: () => eventStream(_nextEvents),
  resolveGrokModel: (model: string) => model,
}))

mock.module('../../utils/messages.js', () => ({
  normalizeMessagesForAPI: (msgs: any) => msgs,
  normalizeContentFromAPI: (blocks: any[]) => blocks,
  createAssistantAPIErrorMessage: (opts: any) => ({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: opts.content }],
      apiError: opts.apiError,
    },
    uuid: 'error-uuid',
    timestamp: new Date().toISOString(),
  }),
}))

mock.module('../../utils/api.js', () => ({
  toolToAPISchema: async (tool: any) => tool,
}))

mock.module('../../utils/debug.js', () => ({
  logForDebugging: () => {},
}))

mock.module('../../cost-tracker.js', () => ({
  addToTotalSessionCost: () => {},
}))

mock.module('../../utils/modelCost.js', () => ({
  calculateUSDCost: () => 0,
}))

mock.module('../../utils/proxy.js', () => ({
  getProxyFetchOptions: () => ({}),
}))

mock.module('../../utils/http.js', () => ({
  getUserAgent: () => 'test-agent',
}))

mock.module('./fetch.js', () => ({
  createCoStrictFetch: () => fetch,
}))

mock.module('./modelMapping.js', () => ({
  resolveCoStrictModel: (model: string) => model,
}))

mock.module('./auth.js', () => ({
  getCoStrictBaseURL: () => 'https://example.test',
}))

mock.module('./credentials.js', () => ({
  loadCoStrictCredentials: async () => ({
    access_token: 'token',
    base_url: 'https://example.test',
  }),
}))

mock.module('./models.js', () => ({
  fetchCoStrictModels: async () => [
    {
      id: 'test-model',
      maxTokens: _mockModelMaxTokens,
      maxTokensKey: 'max_completion_tokens',
    },
  ],
}))

mock.module('../../services/api/openai/requestBody.js', () => ({
  isOpenAIThinkingEnabled: (model: string) => model.includes('deepseek'),
  resolveOpenAIMaxTokens: (
    upperLimit: number,
    maxOutputTokensOverride?: number,
  ) => maxOutputTokensOverride ?? upperLimit,
}))

mock.module('../../bootstrap/state.js', () => ({
  getMainThreadAgentType: () => null,
  getActiveSkillName: () => null,
}))

mock.module('../../utils/context.js', () => ({
  getModelMaxOutputTokens: () => ({ upperLimit: 8192, default: 8192 }),
}))

async function runQueryModel(
  events: BetaRawMessageStreamEvent[],
  optionsOverrides: Record<string, unknown> = {},
  tools: any[] = [],
) {
  _nextEvents = events
  const { queryModelCoStrict } = await import('./index.js')
  const assistantMessages: AssistantMessage[] = []
  const streamEvents: StreamEvent[] = []

  const options: any = {
    model: 'test-model',
    tools,
    agents: [],
    querySource: 'main_loop',
    ...optionsOverrides,
  }

  for await (const item of queryModelCoStrict(
    [],
    { type: 'text', text: '' } as any,
    tools,
    new AbortController().signal,
    options,
  )) {
    if (item.type === 'assistant') {
      assistantMessages.push(item as AssistantMessage)
    } else if (item.type === 'stream_event') {
      streamEvents.push(item as StreamEvent)
    }
  }

  return { assistantMessages, streamEvents }
}

const taskUpdateTool = {
  name: 'TaskUpdate',
  inputSchema: {
    safeParse: (input: Record<string, unknown>) => ({
      success: typeof input.taskId === 'string',
    }),
  },
}

const taskListTool = {
  name: 'TaskList',
  inputSchema: {
    safeParse: () => ({ success: true }),
  },
}

beforeEach(() => {
  _nextEvents = []
  _lastCreateArgs = null
  _mockModelMaxTokens = undefined
})

afterEach(() => {
  _nextEvents = []
  _mockModelMaxTokens = undefined
})

describe('queryModelCoStrict', () => {
  test('yields exactly one AssistantMessage for thinking + text content', async () => {
    const events = [
      makeMessageStart(),
      makeContentBlockStart(0, 'thinking'),
      makeThinkingDelta(0, 'let me think'),
      makeContentBlockStop(0),
      makeContentBlockStart(1, 'text'),
      makeTextDelta(1, 'answer'),
      makeContentBlockStop(1),
      makeMessageDelta('end_turn', 12),
      makeMessageStop(),
    ]

    const { assistantMessages } = await runQueryModel(events)

    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]!.message.stop_reason).toBe('end_turn')
    expect(
      (assistantMessages[0]!.message.content as any[]).map(block => block.type),
    ).toEqual(['thinking', 'text'])
  })

  test('preserves explicit max token override over model metadata default', async () => {
    _mockModelMaxTokens = 16384
    const events = [makeMessageStart(), makeMessageStop()]

    await runQueryModel(events, { maxOutputTokensOverride: 2048 })

    expect(_lastCreateArgs).not.toBeNull()
    expect(_lastCreateArgs!.max_completion_tokens).toBe(2048)
  })

  test('drops empty invalid tool-use placeholders while preserving valid tool calls', async () => {
    const events = [
      makeMessageStart(),
      makeContentBlockStart(0, 'tool_use', {
        id: 'empty-task-update',
        name: 'TaskUpdate',
      }),
      makeContentBlockStop(0),
      makeContentBlockStart(1, 'tool_use', {
        id: 'valid-task-update',
        name: 'TaskUpdate',
      }),
      makeInputJsonDelta(1, '{"taskId":"3","status":"completed"}'),
      makeContentBlockStop(1),
      makeMessageDelta('tool_use', 12),
      makeMessageStop(),
    ]

    const { assistantMessages } = await runQueryModel(events, {}, [
      taskUpdateTool,
    ])

    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]!.message.content).toEqual([
      {
        type: 'tool_use',
        id: 'valid-task-update',
        name: 'TaskUpdate',
        input: '{"taskId":"3","status":"completed"}',
      },
    ])
  })

  test('keeps empty tool-use blocks when the target tool accepts empty input', async () => {
    const events = [
      makeMessageStart(),
      makeContentBlockStart(0, 'tool_use', {
        id: 'task-list',
        name: 'TaskList',
      }),
      makeContentBlockStop(0),
      makeMessageDelta('tool_use', 4),
      makeMessageStop(),
    ]

    const { assistantMessages } = await runQueryModel(events, {}, [
      taskListTool,
    ])

    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]!.message.content).toEqual([
      {
        type: 'tool_use',
        id: 'task-list',
        name: 'TaskList',
        input: '',
      },
    ])
  })
})
