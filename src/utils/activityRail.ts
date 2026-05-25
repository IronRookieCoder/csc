import type { Message } from '../types/message.js'

export type ActivityStatus = 'done' | 'running' | 'pending' | 'attention'

export type ActivityRailItem = {
  id: string
  title: string
  detail?: string
  status: ActivityStatus
}

export type ChangeSetItem = {
  filePath: string
  diffStat: string
  status: ActivityStatus
}

export type QualityGateItem = {
  id: 'requirements' | 'impact' | 'verification'
  label: string
  status: '通过' | '需关注' | '待确认' | '待执行'
}

export type ActivityRailState = {
  activity: ActivityRailItem[]
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
  const content = message.type === 'assistant' || message.type === 'user' ? message.message?.content : undefined
  if (!Array.isArray(content)) return []
  return content.map(toContentBlock).filter(block => block !== undefined)
}

function isToolUseMessage(message: Message): boolean {
  return message.type === 'assistant' && contentBlocks(message).some(block => block.type === 'tool_use')
}

function isToolResultMessage(message: Message): boolean {
  return message.type === 'user' && contentBlocks(message).some(block => block.type === 'tool_result')
}

function shouldKeepInDefaultChat(message: Message): boolean {
  if (isToolUseMessage(message) || isToolResultMessage(message)) return false
  return true
}

function emptyQuality(): QualityGateItem[] {
  return [
    { id: 'requirements', label: '需求一致性', status: '待执行' },
    { id: 'impact', label: '影响范围', status: '待执行' },
    { id: 'verification', label: '测试验证', status: '待执行' },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function toolUsesFromMessage(message: Message): ToolUseBlock[] {
  if (message.type !== 'assistant') return []
  return contentBlocks(message)
    .filter(block => block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string')
    .map(block => ({
      id: block.id as string,
      name: block.name as string,
      input: isRecord(block.input) ? block.input : {},
    }))
}

function toolResultsFromMessage(message: Message): ToolResultBlock[] {
  if (message.type !== 'user') return []
  return contentBlocks(message)
    .filter(block => block.type === 'tool_result' && typeof block.tool_use_id === 'string')
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

function isReadTool(name: string): boolean {
  return name === 'Read' || name === 'Glob' || name === 'Grep'
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

function mergeStatus(current: ActivityStatus, next: ActivityStatus): ActivityStatus {
  return statusPriority(next) > statusPriority(current) ? next : current
}

function upsertActivity(activity: ActivityRailItem[], item: ActivityRailItem): void {
  const existing = activity.find(activityItem => activityItem.id === item.id)
  if (existing === undefined) {
    activity.push(item)
    return
  }

  existing.detail = item.detail
  existing.status = mergeStatus(existing.status, item.status)
}

function upsertChange(changes: ChangeSetItem[], filePath: string, status: ActivityStatus): void {
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

function qualityFromState(changes: ChangeSetItem[], verificationStatus: ActivityStatus | undefined): QualityGateItem[] {
  const verificationGateStatus =
    verificationStatus === 'done' ? '通过' : verificationStatus === 'attention' ? '需关注' : '待执行'

  return [
    { id: 'requirements', label: '需求一致性', status: changes.length > 0 ? '待确认' : '待执行' },
    { id: 'impact', label: '影响范围', status: changes.length > 0 ? '需关注' : '待执行' },
    { id: 'verification', label: '测试验证', status: verificationGateStatus },
  ]
}

function narrowSummaryFromState(railState: ActivityRailState): string {
  if (railState.activity.length === 0 && railState.changes.length === 0) {
    return 'Tools: idle | 0 files changed | tests pending'
  }

  const verification = railState.quality.find(item => item.id === 'verification')
  const tests =
    verification?.status === '通过' ? 'passed' : verification?.status === '需关注' ? 'attention' : 'pending'

  return `Tools: ${railState.activity.length} | ${railState.changes.length} files changed | tests ${tests}`
}

export function deriveActivityRailState(input: ActivityRailInput): ActivityRailDerivedState {
  const chatMessages = input.messages.filter(shouldKeepInDefaultChat)
  const toolUses = input.messages.flatMap(toolUsesFromMessage)
  const resultsByToolUseID = new Map<string, ToolResultBlock>()
  for (const result of input.messages.flatMap(toolResultsFromMessage)) {
    resultsByToolUseID.set(result.toolUseID, result)
  }

  const railState: ActivityRailState = {
    activity: [],
    changes: [],
    quality: emptyQuality(),
  }

  let verificationStatus: ActivityStatus | undefined

  for (const toolUse of toolUses) {
    const status = toolStatus(toolUse.id, resultsByToolUseID, input.inProgressToolUseIDs)

    if (isReadTool(toolUse.name)) {
      upsertActivity(railState.activity, {
        id: 'read-context',
        title: '读取上下文',
        status,
      })
      continue
    }

    if (isEditTool(toolUse.name)) {
      upsertActivity(railState.activity, {
        id: 'prepare-change',
        title: '准备改动',
        status,
      })

      const filePath = filePathFromInput(toolUse.input)
      if (filePath !== undefined) {
        upsertChange(railState.changes, filePath, status)
      }
      continue
    }

    if (toolUse.name === 'Bash') {
      const command = commandFromInput(toolUse.input)
      if (isVerificationCommand(command)) {
        upsertActivity(railState.activity, {
          id: 'verification',
          title: status === 'pending' ? '等待验证' : '执行验证',
          detail: command,
          status,
        })
        verificationStatus = verificationStatus === undefined ? status : mergeStatus(verificationStatus, status)
        continue
      }

      upsertActivity(railState.activity, {
        id: toolUse.id,
        title: '执行工具：Bash',
        detail: command,
        status,
      })
    }
  }

  railState.quality = qualityFromState(railState.changes, verificationStatus)

  return {
    chatMessages,
    railState,
    narrowSummary: narrowSummaryFromState(railState),
  }
}
