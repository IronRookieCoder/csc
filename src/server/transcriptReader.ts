import { readFile, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  getProjectsDir,
  getProjectDir,
  findProjectDir,
} from '../utils/sessionStoragePortable.js'
import { safeParseJSON } from '../utils/json.js'

type TranscriptEntry = {
  type: string
  uuid?: string
  parentUuid?: string
  sessionId?: string
  timestamp?: string
  role?: string
  subtype?: string
  message?: {
    role?: string
    content?: unknown
  }
  content?: unknown
  compactMetadata?: {
    preservedSegment?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type MessagePart =
  | { type: 'text'; id: string; text: string }
  | { type: 'reasoning'; id: string; text: string; redacted?: boolean }
  | {
      type: 'tool'
      id: string
      callID: string
      tool: string
      state:
        | { status: 'pending'; input: Record<string, unknown> }
        | { status: 'running'; input: Record<string, unknown>; title?: string; time: { start: number } }
        | { status: 'completed'; input: Record<string, unknown>; output: string; title: string; time: { start: number; end: number } }
        | { status: 'error'; input: Record<string, unknown>; error: string; time: { start: number; end: number } }
    }
  | { type: 'tool-result'; id: string; toolUseID: string; content: unknown }
  | { type: 'step-start'; id: string }
  | { type: 'step-finish'; id: string; reason: string; cost: number; tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } }
  | { type: 'compaction'; id: string; auto: boolean }

export type SessionMessage = {
  uuid: string
  type: string
  role: string
  content: unknown
  timestamp: number
  parent_uuid: string | null
  usage?: { input_tokens: number; output_tokens: number }
  parts?: MessagePart[]
  error?: {
    name: string
    data: {
      message: string
      statusCode?: number
      isRetryable?: boolean
    }
  }
}

export type TodoItem = {
  id: string
  content: string
  status: string
  priority: string
}

const TOOL_NAME_MAP: Record<string, string> = {
  Read: 'read',
  Edit: 'edit',
  Write: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  LS: 'list',
  Bash: 'bash',
  PowerShell: 'bash',
  Agent: 'task',
  WebFetch: 'webfetch',
  WebSearch: 'websearch',
  TodoRead: 'todoread',
  TodoWrite: 'todowrite',
}

function normalizeToolName(name: string): string {
  return TOOL_NAME_MAP[name] ?? name.toLowerCase()
}

function contentToParts(
  content: unknown,
  role: string,
): MessagePart[] {
  const parts: MessagePart[] = []
  if (!Array.isArray(content)) return parts

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    switch (b.type) {
      case 'text':
        parts.push({ type: 'text', id: crypto.randomUUID(), text: (b.text as string) ?? '' })
        break
      case 'thinking':
        parts.push({ type: 'reasoning', id: crypto.randomUUID(), text: (b.thinking as string) ?? '' })
        break
      case 'redacted_thinking':
        parts.push({ type: 'reasoning', id: crypto.randomUUID(), text: '', redacted: true })
        break
      case 'tool_use':
        parts.push({
          type: 'tool',
          id: crypto.randomUUID(),
          callID: (b.id as string) ?? '',
          tool: normalizeToolName((b.name as string) ?? ''),
          state: {
            status: 'completed',
            input: (b.input as Record<string, unknown>) ?? {},
            output: '',
            title: (b.name as string) ?? '',
            time: { start: Date.now(), end: Date.now() },
          },
        })
        break
      case 'tool_result': {
        parts.push({
          type: 'tool-result',
          id: crypto.randomUUID(),
          toolUseID: (b.tool_use_id as string) ?? '',
          content: b.content,
        })
        break
      }
    }
  }
  return parts
}

export function decomposeMessageToParts(msg: SessionMessage): SessionMessage {
  if (msg.parts && msg.parts.length > 0) return msg
  const content = msg.content
  const role = msg.role
  if (!content || !role) return msg

  if (role === 'assistant' || role === 'user') {
    const parts = contentToParts(content, role)
    const filtered = msg.error
      ? parts.filter(p => p.type !== 'text')
      : parts
    if (filtered.length > 0) {
      return { ...msg, parts: filtered }
    }
  }
  return msg
}

const MESSAGE_TYPES = new Set(['user', 'assistant'])
const SKIP_TYPES = new Set([
  'summary',
  'tag',
  'mode',
  'agent-setting',
  'pr-link',
  'customTitle',
  'file-history-snapshot',
  'attribution-snapshot',
  'context-collapse-commit',
  'context-collapse-snapshot',
])

const pathCache = new Map<string, string | null>()

async function resolveTranscriptPath(
  sessionId: string,
  cwd?: string,
): Promise<string | null> {
  const cacheKey = `${sessionId}:${cwd ?? ''}`
  const cached = pathCache.get(cacheKey)
  // 只缓存找到的路径，不缓存 null（文件可能还未写入）
  if (cached !== undefined && cached !== null) return cached

  const result = await resolveTranscriptPathUncached(sessionId, cwd)
  if (result !== null) {
    pathCache.set(cacheKey, result)
  }
  return result
}

async function resolveTranscriptPathUncached(
  sessionId: string,
  cwd?: string,
): Promise<string | null> {
  if (cwd) {
    const projectDir = getProjectDir(cwd)
    const direct = join(projectDir, `${sessionId}.jsonl`)
    if (existsSync(direct)) return direct
  }

  const found = await findProjectDir(cwd ?? process.cwd())
  if (found) {
    const direct = join(found, `${sessionId}.jsonl`)
    if (existsSync(direct)) return direct
  }

  const projectsDir = getProjectsDir()
  const target = `${sessionId}.jsonl`
  try {
    const dirs = await readdir(projectsDir)
    for (const dir of dirs) {
      const candidate = join(projectsDir, dir, target)
      if (existsSync(candidate)) return candidate
    }
  } catch {}

  return null
}

function parseEntry(line: string): TranscriptEntry | null {
  const parsed = safeParseJSON(line, false)
  if (!parsed || typeof parsed !== 'object') return null
  return parsed as TranscriptEntry
}

function entryToSessionMessage(
  entry: TranscriptEntry,
  includeSystem: boolean,
): SessionMessage | null {
  if (!entry.type || !entry.uuid) return null
  if (SKIP_TYPES.has(entry.type)) return null
  if (entry.type === 'attribution-snapshot') return null

  const includeThis =
    MESSAGE_TYPES.has(entry.type) ||
    (includeSystem && entry.type === 'system')

  if (!includeThis) return null

  const role = entry.role ?? entry.message?.role ?? entry.type
  const content = entry.message?.content ?? entry.content ?? ''

  if (role === 'user' && isTaskNotificationContent(content)) return null

  const timestamp = entry.timestamp
    ? new Date(entry.timestamp).getTime()
    : 0

  const errorRaw = extractApiErrorText(content)
  const detail = errorRaw ? parseApiErrorDetail(errorRaw) : undefined
  const error = detail
    ? { name: 'APIError', data: detail }
    : undefined

  return {
    uuid: entry.uuid,
    type: entry.type,
    role: role ?? entry.type,
    content: error ? [] : content,
    timestamp,
    parent_uuid: entry.parentUuid ?? null,
    usage: entry.usage as
      | { input_tokens: number; output_tokens: number }
      | undefined,
    error,
  }
}

function readMessagesFromLines(
  lines: string[],
  includeSystem: boolean,
): SessionMessage[] {
  const tombstoned = new Set<string>()
  for (const line of lines) {
    if (!line) continue
    const entry = parseEntry(line)
    if (!entry) continue
    if (entry.type === 'tombstone') {
      const targetUuid = (entry.message as Record<string, unknown> | undefined)?.uuid
      if (typeof targetUuid === 'string') tombstoned.add(targetUuid)
    }
  }

  const messages: SessionMessage[] = []
  for (const line of lines) {
    if (!line) continue
    const entry = parseEntry(line)
    if (!entry) continue
    if (entry.uuid && tombstoned.has(entry.uuid)) continue
    const msg = entryToSessionMessage(entry, includeSystem)
    if (msg) messages.push(msg)
  }
  return messages
}

/**
 * Locate the subagent transcript file for a given agentId by scanning
 * `<projectsDir>/<project>/<parentSessionId>/subagents/agent-<agentId>.jsonl`.
 *
 * `cwd` is used to narrow the search to a specific project dir; if omitted or
 * not matched, we fall back to scanning every project directory.
 */
async function findSubagentTranscriptPath(
  agentId: string,
  cwd?: string,
): Promise<string | null> {
  const fileName = `agent-${agentId}.jsonl`

  const searchProject = async (projectDir: string): Promise<string | null> => {
    let sessionDirs: string[]
    try {
      sessionDirs = await readdir(projectDir)
    } catch {
      return null
    }
    for (const sessionDir of sessionDirs) {
      const direct = join(projectDir, sessionDir, 'subagents', fileName)
      try {
        const s = await stat(direct)
        if (s.isFile() && s.size > 0) return direct
      } catch {
      }
      const nestedSubagentsDir = join(projectDir, sessionDir, 'subagents')
      let subdirs: string[]
      try {
        subdirs = await readdir(nestedSubagentsDir)
      } catch {
        continue
      }
      for (const sub of subdirs) {
        const candidate = join(nestedSubagentsDir, sub, fileName)
        try {
          const s = await stat(candidate)
          if (s.isFile() && s.size > 0) return candidate
        } catch {
        }
      }
    }
    return null
  }

  if (cwd) {
    const projectDir = getProjectDir(cwd)
    const hit = await searchProject(projectDir)
    if (hit) return hit

    const found = await findProjectDir(cwd)
    if (found && found !== projectDir) {
      const hit2 = await searchProject(found)
      if (hit2) return hit2
    }
  }

  const projectsDir = getProjectsDir()
  let dirs: string[]
  try {
    dirs = await readdir(projectsDir)
  } catch {
    return null
  }
  for (const dir of dirs) {
    const hit = await searchProject(join(projectsDir, dir))
    if (hit) return hit
  }
  return null
}

async function readSubagentMessages(
  agentId: string,
  cwd: string | undefined,
  includeSystem: boolean,
): Promise<SessionMessage[]> {
  const path = await findSubagentTranscriptPath(agentId, cwd)
  if (!path) return []
  try {
    const raw = await readFile(path, 'utf-8')
    const lines = raw.split('\n')
    return readMessagesFromLines(lines, includeSystem)
  } catch {
    return []
  }
}

export async function readSessionMessages(opts: {
  sessionId: string
  cwd?: string
  limit?: number
  before?: string
  includeSystem?: boolean
}): Promise<{
  messages: SessionMessage[]
  nextCursor?: string
}> {
  const includeSystem = opts.includeSystem ?? false
  const path = await resolveTranscriptPath(opts.sessionId, opts.cwd)

  let mainMessages: SessionMessage[] = []
  if (path && existsSync(path)) {
    const raw = await readFile(path, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)

    let lastCompactBoundaryIndex = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = parseEntry(lines[i])
      if (
        entry?.type === 'system' &&
        entry?.subtype === 'compact_boundary' &&
        !entry?.compactMetadata?.preservedSegment
      ) {
        lastCompactBoundaryIndex = i
        break
      }
    }

    const startLine = lastCompactBoundaryIndex >= 0 ? lastCompactBoundaryIndex + 1 : 0
    mainMessages = readMessagesFromLines(lines.slice(startLine), includeSystem)
  } else {
    // Fallback: 视 sessionId 为 agentId，读取 subagent transcript。
    mainMessages = await readSubagentMessages(opts.sessionId, opts.cwd, includeSystem)
    if (mainMessages.length === 0) {
      return { messages: [] }
    }
  }

  const allMessages = mainMessages
  allMessages.sort((a, b) => a.timestamp - b.timestamp)

  let cursorIndex = -1
  if (opts.before) {
    cursorIndex = allMessages.findIndex(m => m.uuid === opts.before)
  }

  let sliced: SessionMessage[]
  if (cursorIndex >= 0) {
    sliced = allMessages.slice(cursorIndex + 1)
  } else if (opts.limit) {
    sliced = allMessages.slice(-opts.limit)
  } else {
    sliced = allMessages
  }

  const nextCursor =
    opts.limit && allMessages.length > sliced.length
      ? sliced[0]?.uuid
      : undefined

  return { messages: sliced, nextCursor }
}

export async function readSessionTodos(opts: {
  sessionId: string
  cwd?: string
}): Promise<TodoItem[]> {
  const path = await resolveTranscriptPath(opts.sessionId, opts.cwd)
  if (!path || !existsSync(path)) return []

  const raw = await readFile(path, 'utf-8')
  const lines = raw.split('\n').filter(Boolean)

  let latestTodos: TodoItem[] = []

  for (const line of lines) {
    const entry = parseEntry(line)
    if (!entry) continue

    if (entry.type === 'assistant' && entry.message?.content) {
      const content = entry.message.content
      if (!Array.isArray(content)) continue

      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'tool_use' && (b.name === 'TodoWrite' || b.name === 'TaskCreateTool')) {
          const input = b.input as
            | { todos?: Array<{ id: string; content: string; status: string; priority: string }> }
            | undefined
          if (input?.todos) {
            latestTodos = input.todos
          }
        }
      }
    }
  }

  return latestTodos
}

export async function readSessionDiff(opts: {
  sessionId: string
  cwd?: string
  messageID?: string
}): Promise<{
  diffs: Array<{
    file: string
    status: string
    additions: number
    deletions: number
    patch: string
  }>
}> {
  const { execSync } = await import('child_process')
  const cwd = opts.cwd ?? process.cwd()

  try {
    const diffOutput = execSync('git diff HEAD', {
      encoding: 'utf-8',
      timeout: 10000,
      cwd,
    })

    if (!diffOutput.trim()) return { diffs: [] }

    const files = new Map<
      string,
      { additions: number; deletions: number; patch: string }
    >()
    let currentFile = ''
    let currentPatch: string[] = []

    for (const line of diffOutput.split('\n')) {
      const match = /^diff --git a\/(.+?) b\/(.+?)$/.exec(line)
      if (match) {
        if (currentFile && currentPatch.length > 0) {
          files.set(currentFile, {
            additions: currentPatch.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
            deletions: currentPatch.filter(l => l.startsWith('-') && !l.startsWith('---')).length,
            patch: currentPatch.join('\n'),
          })
        }
        currentFile = match[2]
        currentPatch = [line]
      } else {
        currentPatch.push(line)
      }
    }
    if (currentFile && currentPatch.length > 0) {
      files.set(currentFile, {
        additions: currentPatch.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
        deletions: currentPatch.filter(l => l.startsWith('-') && !l.startsWith('---')).length,
        patch: currentPatch.join('\n'),
      })
    }

    return {
      diffs: [...files.entries()].map(([file, info]) => ({
        file,
        status:
          info.additions > 0 && info.deletions > 0
            ? 'modified'
            : info.additions > 0
              ? 'added'
              : 'removed',
        ...info,
      })),
    }
  } catch {
    return { diffs: [] }
  }
}

export type TaskInfo = {
  taskID: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  description: string
  taskType?: string
  summary?: string
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number }
  toolUseID?: string
  startTime: number
  endTime?: number
}

const TASK_NOTIFICATION_RE = /^<task-notification>[\s\S]*<\/task-notification>\s*$/
const TASK_ID_RE = /<task-id>([^<]+)<\/task-id>/
const API_ERROR_RE = /^API Error:\s*/
const COSTRICT_API_ERROR_RE = /^CoStrict API Error:\s*/

function extractApiErrorText(content: unknown): string | null {
  if (typeof content === 'string') {
    if (API_ERROR_RE.test(content)) return content.replace(API_ERROR_RE, '')
    if (COSTRICT_API_ERROR_RE.test(content)) return content.replace(COSTRICT_API_ERROR_RE, '')
  }
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      const text = b.text as string
      if (API_ERROR_RE.test(text)) return text.replace(API_ERROR_RE, '')
      if (COSTRICT_API_ERROR_RE.test(text)) return text.replace(COSTRICT_API_ERROR_RE, '')
    }
  }
  return null
}

function parseApiErrorDetail(raw: string): {
  message: string
  statusCode?: number
  isRetryable?: boolean
} {
  const statusMatch = raw.match(/^(\d{3})\s+/)
  const statusCode = statusMatch ? parseInt(statusMatch[1]!, 10) : undefined
  const isRetryable = statusCode === 429 || statusCode === 503 || statusCode === 529
  let message = raw
  try {
    const jsonStart = raw.indexOf('{')
    if (jsonStart !== -1) {
      const parsed = JSON.parse(raw.slice(jsonStart))
      if (parsed?.error?.message) {
        message = parsed.error.message
      } else if (typeof parsed?.message === 'string') {
        message = parsed.message
      }
    }
  } catch {}
  return { message, statusCode, isRetryable }
}
const TOOL_USE_ID_RE = /<tool-use-id>([^<]+)<\/tool-use-id>/
const TASK_STATUS_RE = /<status>([^<]+)<\/status>/
const TASK_SUMMARY_RE = /<summary>([^<]*)<\/summary>/

function isTaskNotificationContent(content: unknown): boolean {
  return typeof content === 'string' && TASK_NOTIFICATION_RE.test(content)
}

function parseTaskNotificationXml(xml: string): {
  taskID: string
  toolUseID?: string
  status: 'completed' | 'failed' | 'stopped'
  summary?: string
} | null {
  const taskID = TASK_ID_RE.exec(xml)?.[1]
  if (!taskID) return null
  const rawStatus = TASK_STATUS_RE.exec(xml)?.[1] ?? 'completed'
  const status: 'completed' | 'failed' | 'stopped' =
    rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'stopped'
      ? rawStatus
      : 'completed'
  const toolUseID = TOOL_USE_ID_RE.exec(xml)?.[1]
  const summary = TASK_SUMMARY_RE.exec(xml)?.[1]
  return { taskID, toolUseID, status, summary }
}

export async function readSessionTasks(opts: {
  sessionId: string
  cwd?: string
}): Promise<TaskInfo[]> {
  const path = await resolveTranscriptPath(opts.sessionId, opts.cwd)
  if (!path || !existsSync(path)) return []

  const raw = await readFile(path, 'utf-8')
  const lines = raw.split('\n').filter(Boolean)

  const tasks = new Map<string, TaskInfo>()
  const descriptions = new Map<string, string>()

  for (const line of lines) {
    const entry = parseEntry(line)
    if (!entry) continue

    if (entry.type === 'assistant' && entry.message?.content) {
      const content = entry.message.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'LocalMainSessionTask')) {
          const input = b.input as Record<string, unknown> | undefined
          const callID = b.id as string | undefined
          if (input?.description && callID) {
            descriptions.set(callID, input.description as string)
          }
        }
      }
    }

    if (entry.type === 'user' && entry.message?.content) {
      const content = entry.message.content
      if (!isTaskNotificationContent(content)) continue
      const parsed = parseTaskNotificationXml(content as string)
      if (!parsed) continue

      const existing = tasks.get(parsed.taskID)
      const endTime = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
      const desc = existing?.description ?? descriptions.get(parsed.toolUseID ?? '') ?? ''
      tasks.set(parsed.taskID, {
        taskID: parsed.taskID,
        status: parsed.status,
        description: desc,
        toolUseID: parsed.toolUseID ?? existing?.toolUseID,
        summary: parsed.summary ?? existing?.summary,
        usage: existing?.usage,
        startTime: existing?.startTime ?? endTime,
        endTime,
      })
    }
  }

  return [...tasks.values()]
}

export function clearPathCache(): void {
  pathCache.clear()
}
