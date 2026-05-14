/**
 * OpenAI-compatible sideQuery for providers that use the Chat Completions API
 * (openai, grok, costrict). Callers pass a pre-configured OpenAI client and a
 * resolved model name; the rest of the conversion is shared.
 */

import type OpenAI from 'openai'
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions/completions.js'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages.js'
import type { SideQueryOptions } from './sideQuery.js'
import { logEvent } from '../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/metadata.js'
import {
  getLastApiCompletionTimestamp,
  setLastApiCompletionTimestamp,
} from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'

function buildMessages(
  system: SideQueryOptions['system'],
  messages: SideQueryOptions['messages'],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []

  if (system) {
    const systemText = Array.isArray(system)
      ? system.map(b => b.text).join('\n\n')
      : system
    if (systemText.trim()) {
      result.push({ role: 'system', content: systemText })
    }
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as 'user' | 'assistant', content: msg.content })
    } else {
      const text = msg.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('\n')
      result.push({ role: msg.role as 'user' | 'assistant', content: text })
    }
  }

  return result
}

const STOP_REASON_MAP: Record<string, BetaMessage['stop_reason']> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'end_turn',
}

export async function sideQueryOpenAICompat(
  opts: SideQueryOptions,
  client: OpenAI,
  resolvedModel: string,
  providerTag: string,
): Promise<BetaMessage> {
  const { system, messages, max_tokens = 1024, signal, temperature, stop_sequences, querySource } = opts

  logForDebugging(`[${providerTag} sideQuery] querySource=${querySource}, model=${resolvedModel}`)

  const start = Date.now()

  const response = await client.chat.completions.create(
    {
      model: resolvedModel,
      messages: buildMessages(system, messages),
      max_tokens,
      stream: false,
      ...(temperature !== undefined && { temperature }),
      ...(stop_sequences && { stop: stop_sequences }),
    },
    { signal },
  )

  const now = Date.now()
  const lastCompletion = getLastApiCompletionTimestamp()
  const inputTokens = response.usage?.prompt_tokens ?? 0
  const outputTokens = response.usage?.completion_tokens ?? 0

  logEvent('tengu_api_success', {
    requestId: (response.id ?? '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    querySource: querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    model: resolvedModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    inputTokens,
    outputTokens,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    durationMsIncludingRetries: now - start,
    timeSinceLastApiCallMs: lastCompletion !== null ? now - lastCompletion : undefined,
  })
  setLastApiCompletionTimestamp(now)

  const choice = response.choices[0]
  const content: BetaMessage['content'] = []

  if (choice?.message?.content) {
    content.push({ type: 'text', text: choice.message.content, citations: null })
  }

  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      const funcTc = tc as ChatCompletionMessageFunctionToolCall
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(funcTc.function.arguments) as Record<string, unknown>
      } catch {
        // leave input empty on parse failure
      }
      content.push({ type: 'tool_use', id: tc.id, name: funcTc.function.name, input })
    }
  }

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    content,
    model: resolvedModel,
    stop_reason: STOP_REASON_MAP[choice?.finish_reason ?? 'stop'] ?? 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
    },
  } as unknown as BetaMessage
}
