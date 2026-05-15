import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'

function isEmptyObjectInput(input: unknown): boolean {
  if (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    Object.keys(input).length === 0
  ) {
    return true
  }
  if (input === '') return true
  if (typeof input !== 'string') return false

  try {
    const parsed = JSON.parse(input)
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0
    )
  } catch {
    return false
  }
}

function shouldDropEmptyInvalidToolUse(
  toolUse: ToolUseBlock,
  toolUseContext: ToolUseContext,
): boolean {
  if (!isEmptyObjectInput(toolUse.input)) return false

  const tool = findToolByName(toolUseContext.options.tools, toolUse.name)
  if (!tool) return false

  return !tool.inputSchema.safeParse({}).success
}

export function filterEmptyInvalidToolUseMessages(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  toolUseContext: ToolUseContext,
): ToolUseBlock[] {
  const droppedIds = new Set(
    toolUseMessages
      .filter(toolUse => shouldDropEmptyInvalidToolUse(toolUse, toolUseContext))
      .map(toolUse => toolUse.id),
  )
  if (droppedIds.size === 0) return toolUseMessages

  for (const assistantMessage of assistantMessages) {
    const content = assistantMessage.message.content
    if (!Array.isArray(content)) continue
    assistantMessage.message.content = content.filter(
      block =>
        block.type !== 'tool_use' ||
        !('id' in block) ||
        !droppedIds.has(block.id),
    )
  }

  return toolUseMessages.filter(toolUse => !droppedIds.has(toolUse.id))
}
