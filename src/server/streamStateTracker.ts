import { randomUUID } from 'crypto'

type BlockState = {
  type: string
  partID: string
  toolUseID?: string
  toolName?: string
  inputJson: string
  startTime: number
  text: string
}

type SessionStreamState = {
  messageID: string
  parentID: string
  modelID: string
  activeBlocks: Map<number, BlockState>
  stepStartPartID: string
  assistantPartEmitted: boolean
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  stopReason: string
}

export type CanonicalEvent = {
  type: string
  properties: Record<string, unknown>
}

const states = new Map<string, SessionStreamState>()
const streamedSessions = new Set<string>()

type CompletedToolInfo = {
  toolName: string
  partID: string
  messageID: string
  startTime: number
  input: Record<string, unknown>
  title: string
}

const completedTools = new Map<string, Map<string, CompletedToolInfo>>()

function getOrCreate(sessionID: string): SessionStreamState {
  let state = states.get(sessionID)
  if (!state) {
    state = {
      messageID: randomUUID(),
      parentID: '',
      modelID: '',
      activeBlocks: new Map(),
      stepStartPartID: randomUUID(),
      assistantPartEmitted: false,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: '',
    }
    states.set(sessionID, state)
  }
  return state
}

export function resetStreamState(sessionID: string): void {
  states.delete(sessionID)
}

export function resetAllState(sessionID: string): void {
  states.delete(sessionID)
  streamedSessions.delete(sessionID)
  completedTools.delete(sessionID)
  pendingAgentSessions.delete(sessionID)
}

export function hasActiveStream(sessionID: string): boolean {
  return states.has(sessionID)
}

export function consumeStreamedTurn(sessionID: string): boolean {
  if (streamedSessions.has(sessionID)) {
    streamedSessions.delete(sessionID)
    return true
  }
  return false
}

const pendingAgentSessions = new Map<string, Map<string, string>>()

export function registerAgentSession(sessionID: string, toolUseID: string, agentSessionID: string): void {
  let sessionMap = pendingAgentSessions.get(sessionID)
  if (!sessionMap) {
    sessionMap = new Map()
    pendingAgentSessions.set(sessionID, sessionMap)
  }
  sessionMap.set(toolUseID, agentSessionID)
}

export function consumeAgentSession(sessionID: string, toolUseID: string): string | undefined {
  return pendingAgentSessions.get(sessionID)?.get(toolUseID)
}

export function getCompletedToolInfo(sessionID: string, toolUseID: string): CompletedToolInfo | undefined {
  return completedTools.get(sessionID)?.get(toolUseID)
}

export function processStreamEvent(
  sessionID: string,
  event: Record<string, unknown>,
): CanonicalEvent[] {
  const results: CanonicalEvent[] = []
  const state = getOrCreate(sessionID)
  const eventType = event.type as string

  switch (eventType) {
    case 'message_start': {
      const msg = (event as { message?: Record<string, unknown> }).message
      state.messageID = randomUUID()
      state.modelID = (msg?.model as string) ?? ''
      const msgUsage = msg?.usage as Record<string, number> | undefined
      state.usage.inputTokens = msgUsage?.input_tokens ?? 0
      state.usage.cacheReadTokens = msgUsage?.cache_read_input_tokens ?? 0
      state.usage.cacheWriteTokens = msgUsage?.cache_creation_input_tokens ?? 0
      state.activeBlocks.clear()

      if (!state.assistantPartEmitted) {
        results.push({
          type: 'message.updated',
          properties: {
            sessionID,
            info: {
              id: state.messageID,
              role: 'assistant',
              modelID: state.modelID,
              time: { created: Date.now() },
            },
          },
        })
        state.assistantPartEmitted = true
      }

      state.stepStartPartID = randomUUID()
      results.push({
        type: 'message.part.updated',
        properties: {
          sessionID,
          part: { type: 'step-start', id: state.stepStartPartID, messageID: state.messageID, sessionID },
        },
      })
      break
    }

    case 'content_block_start': {
      const evt = event as { content_block?: Record<string, unknown>; index?: number }
      const block = evt.content_block
      const index = evt.index as number
      if (!block) break
      const partID = randomUUID()
      const blockState: BlockState = {
        type: block.type as string,
        partID,
        inputJson: '',
        startTime: Date.now(),
        text: '',
      }

      state.activeBlocks.set(index, blockState)

      if (block.type === 'text') {
        results.push({
          type: 'message.part.updated',
          properties: {
            sessionID,
            part: { type: 'text', id: partID, text: '', messageID: state.messageID, sessionID },
          },
        })
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        results.push({
          type: 'message.part.updated',
          properties: {
            sessionID,
            part: {
              type: 'reasoning',
              id: partID,
              text: '',
              redacted: block.type === 'redacted_thinking',
              messageID: state.messageID, sessionID,
            },
          },
        })
      } else if (block.type === 'tool_use') {
        blockState.toolUseID = block.id as string
        blockState.toolName = block.name as string
        results.push({
          type: 'message.part.updated',
          properties: {
            sessionID,
            part: {
              type: 'tool',
              id: partID,
              callID: block.id,
              tool: normalizeToolName(block.name as string),
              state: { status: 'pending', input: {} },
              messageID: state.messageID, sessionID,
            },
          },
        })
      }
      break
    }

    case 'content_block_delta': {
      const evt = event as { delta?: Record<string, unknown>; index?: number }
      const delta = evt.delta
      const index = evt.index as number
      const blockState = state.activeBlocks.get(index)

      if (!blockState || !delta) break

      if (delta.type === 'text_delta') {
        blockState.text += (delta.text as string) ?? ''
        results.push({
          type: 'message.part.delta',
          properties: {
            sessionID,
            messageID: state.messageID,
            partID: blockState.partID,
            field: 'text',
            delta: delta.text,
          },
        })
      } else if (delta.type === 'thinking_delta') {
        blockState.text += (delta.thinking as string) ?? ''
        results.push({
          type: 'message.part.delta',
          properties: {
            sessionID,
            messageID: state.messageID,
            partID: blockState.partID,
            field: 'text',
            delta: delta.thinking,
          },
        })
      } else if (delta.type === 'input_json_delta') {
        blockState.inputJson += (delta.partial_json as string) ?? ''
      }
      break
    }

    case 'content_block_stop': {
      const index = (event as { index?: number }).index as number
      const blockState = state.activeBlocks.get(index)
      if (!blockState) break
      const now = Date.now()

      if (blockState.type === 'tool_use') {
        let parsedInput: Record<string, unknown> = {}
        try {
          parsedInput = JSON.parse(blockState.inputJson || '{}')
        } catch {
          parsedInput = {}
        }
        parsedInput = normalizeToolInput(parsedInput)
        const title = (parsedInput.description as string) ?? blockState.toolName ?? ''
        const toolState: Record<string, unknown> = {
          status: 'running',
          input: parsedInput,
          title,
          time: { start: blockState.startTime },
        }
        results.push({
          type: 'message.part.updated',
          properties: {
            sessionID,
            part: {
              type: 'tool',
              id: blockState.partID,
              callID: blockState.toolUseID,
              tool: normalizeToolName(blockState.toolName ?? ''),
              state: toolState,
              messageID: state.messageID, sessionID,
            },
          },
        })
        if (blockState.toolUseID) {
          let sessionTools = completedTools.get(sessionID)
          if (!sessionTools) {
            sessionTools = new Map()
            completedTools.set(sessionID, sessionTools)
          }
          sessionTools.set(blockState.toolUseID, {
            toolName: blockState.toolName ?? '',
            partID: blockState.partID,
            messageID: state.messageID,
            startTime: blockState.startTime,
            input: parsedInput,
            title,
          })
        }
      } else if (blockState.type === 'text' || blockState.type === 'thinking' || blockState.type === 'redacted_thinking') {
        const partType = blockState.type === 'text' ? 'text' : 'reasoning'
        results.push({
          type: 'message.part.updated',
          properties: {
            sessionID,
            part: {
              type: partType,
              id: blockState.partID,
              text: blockState.text.trimEnd(),
              messageID: state.messageID, sessionID,
              time: { start: blockState.startTime, end: now },
              ...(blockState.type === 'redacted_thinking' ? { redacted: true } : {}),
            },
          },
        })
      }
      state.activeBlocks.delete(index)
      break
    }

    case 'message_delta': {
      const evt = event as {
        delta?: Record<string, unknown>
        usage?: Record<string, number>
      }
      if (evt.delta?.stop_reason) {
        state.stopReason = evt.delta.stop_reason as string
      }
      if (evt.usage?.output_tokens) {
        state.usage.outputTokens = evt.usage.output_tokens
      }
      break
    }

    case 'message_stop': {
      results.push({
        type: 'message.part.updated',
        properties: {
          sessionID,
          part: {
            type: 'step-finish',
            id: randomUUID(),
            reason: state.stopReason || 'stop',
            cost: 0,
            tokens: {
              input: state.usage.inputTokens,
              output: state.usage.outputTokens,
              reasoning: 0,
              cache: {
                read: state.usage.cacheReadTokens,
                write: state.usage.cacheWriteTokens,
              },
            },
            messageID: state.messageID, sessionID,
          },
        },
      })
      results.push({
        type: 'message.updated',
        properties: {
          sessionID,
          info: {
            id: state.messageID,
            role: 'assistant',
            modelID: state.modelID,
            time: { completed: Date.now() },
          },
        },
      })
      resetStreamState(sessionID)
      streamedSessions.add(sessionID)
      break
    }
  }

  return results
}

function normalizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const renames: Record<string, string> = {
    file_path: 'filePath',
    old_string: 'oldString',
    new_string: 'newString',
    replace_all: 'replaceAll',
  }
  for (const [oldKey, newKey] of Object.entries(renames)) {
    if (oldKey in input) {
      input[newKey] = input[oldKey]
      delete input[oldKey]
    }
  }
  return input
}

function normalizeToolName(name: string): string {
  const map: Record<string, string> = {
    Read: 'read',
    Edit: 'edit',
    Write: 'edit',
    Glob: 'glob',
    Grep: 'grep',
    LS: 'list',
    Bash: 'bash',
    PowerShell: 'bash',
    Agent: 'task',
    Task: 'task',
    WebFetch: 'webfetch',
    WebSearch: 'websearch',
    TodoRead: 'todoread',
    TodoWrite: 'todowrite',
  }
  return map[name] ?? name.toLowerCase()
}
