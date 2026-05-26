import type { Message } from '../types/message.js'
import {
  getTerminalLayout,
  type TerminalLayout,
} from './terminalCapabilities.js'

export type TopBarMode = 'idle' | 'active'
export type TopBarPipelinePhaseID = 'context' | 'locate' | 'edit' | 'verify'
export type TopBarPipelineStatus = 'attention' | 'running' | 'done' | 'pending'

export type TopBarPipelinePhase = {
  id: TopBarPipelinePhaseID
  title: string
  status: TopBarPipelineStatus
  detail?: string
}

export type TopBarInput = {
  messages: Message[]
  inProgressToolUseIDs: ReadonlySet<string>
  sessionTitle: string
  branch: string
  brandVersion: string
  columns: number
}

export type TopBarState = {
  mode: TopBarMode
  sessionTitle: string
  branch: string
  brandVersion: string
  pipeline: TopBarPipelinePhase[]
  layout: TerminalLayout
}

type ContentBlock = {
  type?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  is_error?: boolean
}

type ToolUseBlock = {
  id: string
  messageID?: string
  name: string
  input: Record<string, unknown>
}

type ToolResultBlock = {
  toolUseID: string
  isError: boolean
}

const phaseTitles: Record<TopBarPipelinePhaseID, string> = {
  context: 'Context',
  locate: 'Locate',
  edit: 'Changes',
  verify: 'Verify',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function toContentBlock(block: unknown): ContentBlock | undefined {
  if (!isRecord(block)) return undefined
  return block
}

function contentBlocks(message: Message): ContentBlock[] {
  const content =
    message.type === 'assistant' || message.type === 'user'
      ? message.message?.content
      : undefined
  if (!Array.isArray(content)) return []
  return content.map(toContentBlock).filter(block => block !== undefined)
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
      messageID:
        typeof message.message?.id === 'string'
          ? message.message.id
          : undefined,
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

function commandFromInput(input: Record<string, unknown>): string | undefined {
  const command = input.command
  return typeof command === 'string' ? command : undefined
}

function detailFromInput(input: Record<string, unknown>): string | undefined {
  const filePath = input.file_path
  if (typeof filePath === 'string') return filePath

  const path = input.path
  if (typeof path === 'string') return path

  const pattern = input.pattern
  if (typeof pattern === 'string') return pattern

  const glob = input.glob
  if (typeof glob === 'string') return glob

  return commandFromInput(input)
}

function isContextTool(name: string): boolean {
  return name === 'Read'
}

function isLocateTool(name: string): boolean {
  return name === 'Glob' || name === 'Grep'
}

function isEditTool(name: string): boolean {
  return name === 'Edit' || name === 'MultiEdit' || name === 'Write'
}

function commandTokens(command: string): string[] {
  return command
    .toLowerCase()
    .split(/[^a-z0-9_.:-]+/)
    .filter(token => token.length > 0)
}

function scriptName(token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  if (token.endsWith(':fix') || token.endsWith(':write')) return undefined
  return token.split(':')[0]
}

function isVerificationScript(token: string | undefined): boolean {
  const name = scriptName(token)
  return (
    name === 'test' ||
    name === 'lint' ||
    name === 'typecheck' ||
    name === 'build' ||
    name === 'tsc'
  )
}

function isVerificationExecutable(token: string | undefined): boolean {
  return (
    token === 'tsc' ||
    token === 'vitest' ||
    token === 'eslint' ||
    token === 'jest' ||
    token === 'pytest' ||
    token === 'lint' ||
    token === 'typecheck' ||
    token === 'build'
  )
}

function isBiomeVerificationSubcommand(token: string | undefined): boolean {
  return token === 'check' || token === 'ci' || token === 'lint'
}

function isVerificationCommand(command: string | undefined): boolean {
  if (command === undefined) return false
  const tokens = commandTokens(command)
  const commandName = tokens[0]
  const second = tokens[1]
  const third = tokens[2]
  const hasWriteFlag = tokens.includes('--write')
  const hasFixFlag = tokens.includes('--fix')

  if (hasWriteFlag || hasFixFlag) return false
  if (isVerificationExecutable(commandName)) return true
  if (commandName === 'bun')
    return second === 'run'
      ? isVerificationScript(third)
      : isVerificationScript(second)
  if (commandName === 'biome')
    return !hasWriteFlag && isBiomeVerificationSubcommand(second)
  if ((commandName === 'bunx' || commandName === 'npx') && second === 'biome')
    return !hasWriteFlag && isBiomeVerificationSubcommand(third)
  if (commandName === 'bunx' || commandName === 'npx')
    return isVerificationExecutable(second)
  if (
    commandName === 'npm' ||
    commandName === 'pnpm' ||
    commandName === 'yarn'
  ) {
    if (second === 'run') return isVerificationScript(third)
    return isVerificationScript(second)
  }
  if (commandName === 'make') return isVerificationScript(second)

  return false
}

function phaseIDForToolUse(
  toolUse: ToolUseBlock,
): TopBarPipelinePhaseID | undefined {
  if (isContextTool(toolUse.name)) return 'context'
  if (isLocateTool(toolUse.name)) return 'locate'
  if (isEditTool(toolUse.name)) return 'edit'
  if (
    (toolUse.name === 'Bash' || toolUse.name === 'PowerShell') &&
    isVerificationCommand(commandFromInput(toolUse.input))
  ) {
    return 'verify'
  }
  return undefined
}

function statusForToolUse(
  toolUseID: string,
  resultsByToolUseID: ReadonlyMap<string, ToolResultBlock>,
  inProgressToolUseIDs: ReadonlySet<string>,
): TopBarPipelineStatus {
  const result = resultsByToolUseID.get(toolUseID)
  if (result !== undefined) return result.isError ? 'attention' : 'done'
  if (inProgressToolUseIDs.has(toolUseID)) return 'running'
  return 'pending'
}

function statusPriority(status: TopBarPipelineStatus): number {
  if (status === 'attention') return 4
  if (status === 'running') return 3
  if (status === 'done') return 2
  return 1
}

function mergeStatus(
  current: TopBarPipelineStatus,
  next: TopBarPipelineStatus,
): TopBarPipelineStatus {
  return statusPriority(next) > statusPriority(current) ? next : current
}

function emptyPipeline(): TopBarPipelinePhase[] {
  return [
    { id: 'context', title: phaseTitles.context, status: 'pending' },
    { id: 'locate', title: phaseTitles.locate, status: 'pending' },
    { id: 'edit', title: phaseTitles.edit, status: 'pending' },
    { id: 'verify', title: phaseTitles.verify, status: 'pending' },
  ]
}

function upsertPipelinePhase(
  pipeline: TopBarPipelinePhase[],
  phaseID: TopBarPipelinePhaseID,
  status: TopBarPipelineStatus,
  detail: string | undefined,
): void {
  const phase = pipeline.find(item => item.id === phaseID)
  if (phase === undefined) return

  const nextStatus = mergeStatus(phase.status, status)
  const candidateWins = statusPriority(status) > statusPriority(phase.status)
  const candidateTies = status === phase.status

  phase.status = nextStatus
  if (candidateWins) {
    phase.detail = detail
    return
  }

  if (detail !== undefined && candidateTies) {
    phase.detail = detail
  }
}

export function deriveTopBarState(input: TopBarInput): TopBarState {
  const pipeline = emptyPipeline()
  const resultsByToolUseID = new Map<string, ToolResultBlock>()
  const toolUses = input.messages.flatMap(toolUsesFromMessage)

  for (const result of input.messages.flatMap(toolResultsFromMessage)) {
    resultsByToolUseID.set(result.toolUseID, result)
  }

  const latestToolUseMessage = input.messages.findLast(message =>
    toolUsesFromMessage(message).some(toolUse => toolUse.id !== undefined),
  )
  const latestToolUseMessageID =
    latestToolUseMessage?.type === 'assistant' &&
    typeof latestToolUseMessage.message?.id === 'string'
      ? latestToolUseMessage.message.id
      : undefined
  const latestToolUseIDs = new Set(
    latestToolUseMessageID === undefined
      ? latestToolUseMessage === undefined
        ? []
        : toolUsesFromMessage(latestToolUseMessage).map(toolUse => toolUse.id)
      : toolUses
          .filter(toolUse => toolUse.messageID === latestToolUseMessageID)
          .map(toolUse => toolUse.id),
  )
  const activeInProgressToolUseIDs = new Set(
    [...input.inProgressToolUseIDs].filter(
      toolUseID =>
        latestToolUseIDs.has(toolUseID) && !resultsByToolUseID.has(toolUseID),
    ),
  )
  const hasUnresolvedInProgressTool = activeInProgressToolUseIDs.size > 0

  for (const toolUse of toolUses) {
    const phaseID = phaseIDForToolUse(toolUse)
    if (phaseID === undefined) continue

    const status = statusForToolUse(
      toolUse.id,
      resultsByToolUseID,
      activeInProgressToolUseIDs,
    )

    upsertPipelinePhase(
      pipeline,
      phaseID,
      status,
      detailFromInput(toolUse.input),
    )
  }

  return {
    mode: hasUnresolvedInProgressTool ? 'active' : 'idle',
    sessionTitle: input.sessionTitle,
    branch: input.branch,
    brandVersion: input.brandVersion,
    pipeline,
    layout: getTerminalLayout(input.columns),
  }
}
