import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { AssistantMessage } from '../../../types/message.js'

function makeMessageStart(): BetaRawMessageStreamEvent {
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
    },
  } as any
}

function makeToolStart(
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

function makeContentBlockStop(index: number): BetaRawMessageStreamEvent {
  return { type: 'content_block_stop', index } as any
}

function makeMessageDelta(stopReason: string): BetaRawMessageStreamEvent {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 1 },
  } as any
}

function makeMessageStop(): BetaRawMessageStreamEvent {
  return { type: 'message_stop' } as any
}

async function* eventStream(events: BetaRawMessageStreamEvent[]) {
  for (const event of events) yield event
}

let nextEvents: BetaRawMessageStreamEvent[] = []

mock.module('./client.js', () => ({
  getGrokClient: () => ({
    chat: {
      completions: {
        create: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
      },
    },
  }),
}))

mock.module('@ant/model-provider', () => ({
  anthropicMessagesToOpenAI: () => [],
  anthropicToolsToOpenAI: () => [],
  anthropicToolChoiceToOpenAI: () => undefined,
  adaptOpenAIStreamToAnthropic: () => eventStream(nextEvents),
  resolveGrokModel: (model: string) => model,
}))

mock.module('../../../utils/messages.js', () => ({
  normalizeMessagesForAPI: (messages: unknown) => messages,
  normalizeContentFromAPI: (blocks: unknown[]) => blocks,
  createAssistantAPIErrorMessage: (opts: { content: string }) => ({
    type: 'assistant',
    message: { content: [{ type: 'text', text: opts.content }] },
    uuid: 'error-uuid',
    timestamp: new Date().toISOString(),
  }),
}))

mock.module('../../../utils/api.js', () => ({
  toolToAPISchema: async (tool: unknown) => tool,
}))

mock.module('../../../utils/debug.js', () => ({
  logForDebugging: () => {},
}))

mock.module('../../../cost-tracker.js', () => ({
  addToTotalSessionCost: () => {},
}))

mock.module('../../../utils/modelCost.js', () => ({
  calculateUSDCost: () => 0,
}))

mock.module('../../../services/langfuse/tracing.js', () => ({
  recordLLMObservation: () => {},
}))

mock.module('../../../services/langfuse/convert.js', () => ({
  convertMessagesToLangfuse: () => [],
  convertOutputToLangfuse: () => [],
  convertToolsToLangfuse: () => [],
}))

const taskUpdateTool = {
  name: 'TaskUpdate',
  inputSchema: {
    safeParse: (input: Record<string, unknown>) => ({
      success: typeof input.taskId === 'string',
    }),
  },
}

beforeEach(() => {
  nextEvents = []
})

async function runQuery(events: BetaRawMessageStreamEvent[]) {
  nextEvents = events
  const { queryModelGrok } = await import('./index.js')
  const assistantMessages: AssistantMessage[] = []

  for await (const item of queryModelGrok(
    [],
    { type: 'text', text: '' } as any,
    [taskUpdateTool] as any,
    new AbortController().signal,
    {
      model: 'test-model',
      tools: [taskUpdateTool],
      agents: [],
      querySource: 'main_loop',
    } as any,
  )) {
    if (item.type === 'assistant') {
      assistantMessages.push(item as AssistantMessage)
    }
  }

  return assistantMessages
}

describe('queryModelGrok', () => {
  test('drops empty invalid tool-use placeholders while preserving valid tool calls', async () => {
    const assistantMessages = await runQuery([
      makeMessageStart(),
      makeToolStart(0, 'empty-task-update', 'TaskUpdate'),
      makeContentBlockStop(0),
      makeToolStart(1, 'valid-task-update', 'TaskUpdate'),
      makeInputJsonDelta(1, '{"taskId":"3","status":"completed"}'),
      makeContentBlockStop(1),
      makeMessageDelta('tool_use'),
      makeMessageStop(),
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

  test('keeps a lone empty invalid tool-use block so tool validation can respond', async () => {
    const assistantMessages = await runQuery([
      makeMessageStart(),
      makeToolStart(0, 'empty-task-update', 'TaskUpdate'),
      makeContentBlockStop(0),
      makeMessageDelta('tool_use'),
      makeMessageStop(),
    ])

    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]!.message.content).toEqual([
      {
        type: 'tool_use',
        id: 'empty-task-update',
        name: 'TaskUpdate',
        input: '',
      },
    ])
  })
})
