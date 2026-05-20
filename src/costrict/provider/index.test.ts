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
  type: 'text' | 'thinking',
): BetaRawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block:
      type === 'text'
        ? { type: 'text', text: '' }
        : { type: 'thinking', thinking: '', signature: '' },
  } as any
}

function makeToolUseStart(
  index: number,
  id: string,
  name: string,
): BetaRawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: {
      type: 'tool_use',
      id,
      name,
      input: {},
    },
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
let _mockModelSupportsImages: boolean | undefined
let _mockCreateError: Error | undefined

mock.module('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: async (args: Record<string, any>) => {
          _lastCreateArgs = args
          if (_mockCreateError) throw _mockCreateError
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
}))

mock.module('../../utils/messages.js', () => ({
  normalizeMessagesForAPI: (msgs: any) => msgs,
  ensureToolResultPairing: (msgs: any) => msgs,
  normalizeContentFromAPI: (
    blocks: any[],
    _tools: any,
    _agentId: any,
    opts?: any,
  ) =>
    blocks.map(block => {
      if (
        opts?.preserveInvalidToolCall &&
        block.type === 'tool_use' &&
        block.invalidToolCallError
      ) {
        return {
          ...block,
          input: {},
        }
      }
      if (block.type === 'tool_use' && typeof block.input === 'string') {
        return {
          ...block,
          input: JSON.parse(block.input),
        }
      }
      return block
    }),
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
      supportsImages: _mockModelSupportsImages,
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
  messages: any[] = [],
) {
  _nextEvents = events
  const { queryModelCoStrict } = await import('./index.js')
  const assistantMessages: AssistantMessage[] = []
  const streamEvents: StreamEvent[] = []

  const options: any = {
    model: 'test-model',
    tools: [],
    agents: [],
    querySource: 'main_loop',
    ...optionsOverrides,
  }

  for await (const item of queryModelCoStrict(
    messages,
    { type: 'text', text: '' } as any,
    [],
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

beforeEach(() => {
  _nextEvents = []
  _lastCreateArgs = null
  _mockModelMaxTokens = undefined
  _mockModelSupportsImages = undefined
  _mockCreateError = undefined
})

afterEach(() => {
  _nextEvents = []
  _mockModelMaxTokens = undefined
  _mockModelSupportsImages = undefined
  _mockCreateError = undefined
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

  test('returns a clear error before sending images to non-multimodal model', async () => {
    _mockModelSupportsImages = false
    const messages = [
      {
        type: 'user',
        uuid: 'user-img',
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_img',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'iVBORw0KGgo=',
                  },
                },
              ],
            },
          ],
        },
      },
    ]

    const { assistantMessages } = await runQueryModel([], {}, messages)

    expect(_lastCreateArgs).toBeNull()
    expect(assistantMessages).toHaveLength(1)
    expect((assistantMessages[0]!.message.content as any[])[0].text).toContain(
      'does not support image input',
    )
  })

  test('allows images when model metadata declares multimodal support', async () => {
    _mockModelSupportsImages = true
    const events = [makeMessageStart(), makeMessageStop()]
    const messages = [
      {
        type: 'user',
        uuid: 'user-img',
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgo=',
              },
            },
          ],
        },
      },
    ]

    await runQueryModel(events, {}, messages)

    expect(_lastCreateArgs).not.toBeNull()
  })

  test('normalizes backend non-multimodal model errors', async () => {
    _mockCreateError = new Error('/mnt/model is not a multimodal model')

    const { assistantMessages } = await runQueryModel([], {})

    expect(assistantMessages).toHaveLength(1)
    expect((assistantMessages[0]!.message.content as any[])[0].text).toBe(
      'CoStrict API Error: The current model does not support image input. Switch to a multimodal or vision-capable model and try again.',
    )
  })

  test('marks malformed final tool JSON as invalid while preserving id and name', async () => {
    const events = [
      makeMessageStart(),
      makeToolUseStart(0, 'toolu_bad', 'TaskUpdate'),
      makeInputJsonDelta(0, '{"status": '),
      makeInputJsonDelta(0, 'in_progresss"'),
      makeInputJsonDelta(0, ', "taskId": "1"}'),
      makeContentBlockStop(0),
      makeMessageDelta('tool_use', 5),
      makeMessageStop(),
    ]

    const { assistantMessages } = await runQueryModel(events)

    expect(assistantMessages).toHaveLength(1)
    const toolUse = (assistantMessages[0]!.message.content as any[])[0]
    expect(toolUse).toMatchObject({
      type: 'tool_use',
      id: 'toolu_bad',
      name: 'TaskUpdate',
      input: {},
    })
    expect(toolUse.invalidToolCallError).toContain(
      'invalid tool call arguments for TaskUpdate',
    )
  })

  test('does not execute partial-json result when final raw input is malformed', async () => {
    const events = [
      makeMessageStart(),
      makeToolUseStart(0, 'toolu_partial_bad', 'TaskUpdate'),
      makeInputJsonDelta(0, '{"status":"in_progress","taskId":"1"}'),
      makeInputJsonDelta(0, ' trailing'),
      makeContentBlockStop(0),
      makeMessageDelta('tool_use', 5),
      makeMessageStop(),
    ]

    const { assistantMessages, streamEvents } = await runQueryModel(events)

    const parsedPartialEvent = streamEvents.find(
      event =>
        (event.event as any).type === 'content_block_delta' &&
        (event.event as any).delta.parsed_tool_input !== undefined,
    )
    expect((parsedPartialEvent!.event as any).delta.parsed_tool_input).toEqual({
      status: 'in_progress',
      taskId: '1',
    })

    const toolUse = (assistantMessages[0]!.message.content as any[])[0]
    expect(toolUse.input).toEqual({})
    expect(toolUse.invalidToolCallError).toContain(
      'invalid tool call arguments for TaskUpdate',
    )
  })

  test('keeps valid TaskUpdate JSON executable', async () => {
    const events = [
      makeMessageStart(),
      makeToolUseStart(0, 'toolu_good', 'TaskUpdate'),
      makeInputJsonDelta(0, '{"status":"completed","taskId":"1"}'),
      makeContentBlockStop(0),
      makeMessageDelta('tool_use', 5),
      makeMessageStop(),
    ]

    const { assistantMessages } = await runQueryModel(events)

    const toolUse = (assistantMessages[0]!.message.content as any[])[0]
    expect(toolUse).toMatchObject({
      type: 'tool_use',
      id: 'toolu_good',
      name: 'TaskUpdate',
      input: { status: 'completed', taskId: '1' },
    })
    expect(toolUse.invalidToolCallError).toBeUndefined()
  })
})
