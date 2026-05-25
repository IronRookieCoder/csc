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

function firstBlock(message: Message): ContentBlock | undefined {
  const content = message.type === 'assistant' || message.type === 'user' ? message.message?.content : undefined
  if (!Array.isArray(content)) return undefined
  const block = content[0]
  if (block == null || typeof block === 'string') return undefined
  return block as ContentBlock
}

function isToolUseMessage(message: Message): boolean {
  return message.type === 'assistant' && firstBlock(message)?.type === 'tool_use'
}

function isToolResultMessage(message: Message): boolean {
  return message.type === 'user' && firstBlock(message)?.type === 'tool_result'
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

export function deriveActivityRailState(input: ActivityRailInput): ActivityRailDerivedState {
  const chatMessages = input.messages.filter(shouldKeepInDefaultChat)
  const railState: ActivityRailState = {
    activity: [],
    changes: [],
    quality: emptyQuality(),
  }

  return {
    chatMessages,
    railState,
    narrowSummary: 'Tools: idle | 0 files changed | tests pending',
  }
}
