import type { Tool, Tools } from '../../../Tool.js'

type StreamContentBlock = {
  type?: unknown
  input?: unknown
  name?: unknown
}

function shouldDropEmptyInvalidToolUseBlock(
  block: StreamContentBlock,
  tools: Tools,
): boolean {
  if (
    block.type !== 'tool_use' ||
    !isEmptyObjectInput(block.input) ||
    typeof block.name !== 'string'
  ) {
    return false
  }

  const tool = findToolByNameLightweight(tools, block.name)
  if (!tool) return false

  return !tool.inputSchema.safeParse({}).success
}

function findToolByNameLightweight(
  tools: Tools,
  name: string,
): Tool | undefined {
  return tools.find(
    tool => tool.name === name || (tool.aliases?.includes(name) ?? false),
  )
}

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

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

export function getFinalContentBlocks<T extends StreamContentBlock>(
  contentBlocks: Record<number, T | undefined>,
  tools: Tools,
): T[] {
  const orderedBlocks = Object.keys(contentBlocks)
    .sort((a, b) => Number(a) - Number(b))
    .map(k => contentBlocks[Number(k)])
    .filter(isDefined)
  const filteredBlocks = orderedBlocks.filter(
    block => !shouldDropEmptyInvalidToolUseBlock(block, tools),
  )

  // If the model emitted only empty invalid tool calls, keep them visible so
  // the normal tool validation path can return an InputValidationError. Dropping
  // the whole response makes the turn end silently.
  return filteredBlocks.length > 0 ? filteredBlocks : orderedBlocks
}
