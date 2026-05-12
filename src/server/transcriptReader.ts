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

export type SessionMessage = {
  uuid: string
  type: string
  role: string
  content: unknown
  timestamp: number
  parent_uuid: string | null
  usage?: { input_tokens: number; output_tokens: number }
}

export type TodoItem = {
  id: string
  content: string
  status: string
  priority: string
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
  const path = await resolveTranscriptPath(opts.sessionId, opts.cwd)
  if (!path || !existsSync(path)) {
    return { messages: [] }
  }

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

  const allMessages: SessionMessage[] = []
  let cursorIndex = -1

  for (let i = startLine; i < lines.length; i++) {
    const entry = parseEntry(lines[i])
    if (!entry) continue
    if (!entry.type || !entry.uuid) continue
    if (SKIP_TYPES.has(entry.type)) continue
    if (entry.type === 'attribution-snapshot') continue

    const includeThis =
      MESSAGE_TYPES.has(entry.type) ||
      (opts.includeSystem && entry.type === 'system')

    if (!includeThis) continue

    if (entry.uuid === opts.before) {
      cursorIndex = allMessages.length
    }

    const role = entry.role ?? entry.message?.role ?? entry.type
    const content = entry.message?.content ?? entry.content ?? ''
    const timestamp = entry.timestamp
      ? new Date(entry.timestamp).getTime()
      : 0

    allMessages.push({
      uuid: entry.uuid,
      type: entry.type,
      role: role ?? entry.type,
      content,
      timestamp,
      parent_uuid: entry.parentUuid ?? null,
      usage: entry.usage as
        | { input_tokens: number; output_tokens: number }
        | undefined,
    })
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

export function clearPathCache(): void {
  pathCache.clear()
}
