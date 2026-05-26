import type { Message } from '../types/message.js'

export type ActivityStatus = 'done' | 'running' | 'pending' | 'attention'

export type ChangeSetItem = {
  filePath: string
  diffStat: string
  status: ActivityStatus
}

export type QualityGateItem = {
  id: 'requirements' | 'impact' | 'verification'
  label: string
  status: 'passed' | 'attention' | 'pending-review' | 'pending'
}

export type ActivityRailState = {
  changes: ChangeSetItem[]
  quality: QualityGateItem[]
}

export type ActivityRailInput = {
  messages: Message[]
  inProgressToolUseIDs: ReadonlySet<string>
}

export type ActivityRailDerivedState = {
  chatMessages: Message[]
  railState: ActivityRailState
  narrowSummary: string
}

type ContentBlock = {
  type?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  is_error?: boolean
  text?: string
}

type ToolUseBlock = {
  id: string
  name: string
  input: Record<string, unknown>
}

type ToolResultBlock = {
  toolUseID: string
  isError: boolean
}

function toContentBlock(block: unknown): ContentBlock | undefined {
  if (block == null || typeof block === 'string') return undefined
  return block as ContentBlock
}

function contentBlocks(message: Message): ContentBlock[] {
  const content =
    message.type === 'assistant' || message.type === 'user'
      ? message.message?.content
      : undefined
  if (!Array.isArray(content)) return []
  return content.map(toContentBlock).filter(block => block !== undefined)
}

function isToolActivityBlock(block: ContentBlock): boolean {
  return block.type === 'tool_use' || block.type === 'tool_result'
}

function messageWithFilteredContent(
  message: Message,
  content: ContentBlock[],
): Message | undefined {
  const visibleContent = content.filter(block => !isToolActivityBlock(block))
  if (visibleContent.length === 0) return undefined
  return {
    ...message,
    message: {
      ...message.message,
      content: visibleContent,
    },
  } as Message
}

function defaultChatMessage(message: Message): Message | undefined {
  if (message.type !== 'assistant' && message.type !== 'user') {
    return message
  }

  const content = contentBlocks(message)
  if (!content.some(isToolActivityBlock)) {
    return message
  }

  return messageWithFilteredContent(message, content)
}

function textFromContentBlock(block: ContentBlock): string {
  return typeof block.text === 'string' ? block.text.trim() : ''
}

function hasVisibleTextContent(message: Message): boolean {
  if (message.type !== 'assistant' && message.type !== 'user') return false
  return contentBlocks(message).some(block => block.type === 'text' && textFromContentBlock(block).length > 0)
}

export function hasVisibleConversationContent(messages: readonly Message[]): boolean {
  return messages.some(message => {
    if (message.type === 'assistant') return hasVisibleTextContent(message)
    if (message.type === 'user') {
      if ('isMeta' in message && message.isMeta === true) return false
      const content = contentBlocks(message)
      if (content.length === 0) return false
      if (content.every(isToolActivityBlock)) return false
      return content.some(block => block.type === 'text' && textFromContentBlock(block).length > 0)
    }
    return false
  })
}

function emptyQuality(): QualityGateItem[] {
  return [
    { id: 'requirements', label: 'Requirements', status: 'pending' },
    { id: 'impact', label: 'Impact', status: 'pending' },
    { id: 'verification', label: 'Verification', status: 'pending' },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function toolUsesFromMessage(message: Message): ToolUseBlock[] {
  if (message.type !== 'assistant') return []
  return contentBlocks(message)
    .filter(
      block =>
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string',
    )
    .map(block => ({
      id: block.id as string,
      name: block.name as string,
      input: isRecord(block.input) ? block.input : {},
    }))
}

function toolResultsFromMessage(message: Message): ToolResultBlock[] {
  if (message.type !== 'user') return []
  return contentBlocks(message)
    .filter(
      block =>
        block.type === 'tool_result' && typeof block.tool_use_id === 'string',
    )
    .map(block => ({
      toolUseID: block.tool_use_id as string,
      isError: block.is_error === true,
    }))
}

function toolStatus(
  toolUseID: string,
  resultsByToolUseID: ReadonlyMap<string, ToolResultBlock>,
  inProgressToolUseIDs: ReadonlySet<string>,
): ActivityStatus {
  const result = resultsByToolUseID.get(toolUseID)
  if (result !== undefined) return result.isError ? 'attention' : 'done'
  if (inProgressToolUseIDs.has(toolUseID)) return 'running'
  return 'pending'
}

function commandFromInput(input: Record<string, unknown>): string | undefined {
  const command = input.command
  return typeof command === 'string' ? command : undefined
}

function filePathFromInput(input: Record<string, unknown>): string | undefined {
  const filePath = input.file_path
  return typeof filePath === 'string' ? filePath : undefined
}

function isEditTool(name: string): boolean {
  return name === 'Edit' || name === 'MultiEdit' || name === 'Write'
}

function isVerificationCommand(command: string | undefined): boolean {
  if (command === undefined) return false
  return /\b(test|lint|typecheck|tsc|build)\b/i.test(command)
}

function statusPriority(status: ActivityStatus): number {
  if (status === 'attention') return 4
  if (status === 'running') return 3
  if (status === 'pending') return 2
  return 1
}

function mergeStatus(
  current: ActivityStatus,
  next: ActivityStatus,
): ActivityStatus {
  return statusPriority(next) > statusPriority(current) ? next : current
}

function upsertChange(
  changes: ChangeSetItem[],
  filePath: string,
  status: ActivityStatus,
): void {
  const existing = changes.find(change => change.filePath === filePath)
  if (existing === undefined) {
    changes.push({
      filePath,
      diffStat: 'modified',
      status,
    })
    return
  }

  existing.status = mergeStatus(existing.status, status)
}

function qualityFromState(
  changes: ChangeSetItem[],
  verificationStatus: ActivityStatus | undefined,
): QualityGateItem[] {
  const verificationGateStatus =
    verificationStatus === 'done'
      ? 'passed'
      : verificationStatus === 'attention'
        ? 'attention'
        : 'pending'

  return [
    {
      id: 'requirements',
      label: 'Requirements',
      status: changes.length > 0 ? 'pending-review' : 'pending',
    },
    {
      id: 'impact',
      label: 'Impact',
      status: changes.length > 0 ? 'attention' : 'pending',
    },
    { id: 'verification', label: 'Verification', status: verificationGateStatus },
  ]
}

function narrowSummaryFromState(railState: ActivityRailState): string {
  const verification = railState.quality.find(
    item => item.id === 'verification',
  )
  const tests =
    verification?.status === 'passed'
      ? 'passed'
      : verification?.status === 'attention'
        ? 'attention'
        : 'pending'
  const fileLabel = railState.changes.length === 1 ? 'file' : 'files'
  const attentionCount = railState.changes.filter(
    item => item.status === 'attention',
  ).length
  const attentionSummary =
    attentionCount > 0 ? `, ${attentionCount} attention` : ''

  return `Changes: ${railState.changes.length} ${fileLabel} changed${attentionSummary} | tests ${tests}`
}

export function deriveActivityRailState(
  input: ActivityRailInput,
): ActivityRailDerivedState {
  const chatMessages = input.messages
    .map(defaultChatMessage)
    .filter(message => message !== undefined)
  const toolUses = input.messages.flatMap(toolUsesFromMessage)
  const resultsByToolUseID = new Map<string, ToolResultBlock>()
  for (const result of input.messages.flatMap(toolResultsFromMessage)) {
    resultsByToolUseID.set(result.toolUseID, result)
  }

  const railState: ActivityRailState = {
    changes: [],
    quality: emptyQuality(),
  }

  let verificationStatus: ActivityStatus | undefined

  for (const toolUse of toolUses) {
    const status = toolStatus(
      toolUse.id,
      resultsByToolUseID,
      input.inProgressToolUseIDs,
    )

    if (isEditTool(toolUse.name)) {
      const filePath = filePathFromInput(toolUse.input)
      if (filePath !== undefined) {
        upsertChange(railState.changes, filePath, status)
      }
      continue
    }

    if (toolUse.name === 'Bash') {
      const command = commandFromInput(toolUse.input)
      if (isVerificationCommand(command)) {
        verificationStatus =
          verificationStatus === undefined
            ? status
            : mergeStatus(verificationStatus, status)
      }
    }
  }

  railState.quality = qualityFromState(railState.changes, verificationStatus)

  return {
    chatMessages,
    railState,
    narrowSummary: narrowSummaryFromState(railState),
  }
}
