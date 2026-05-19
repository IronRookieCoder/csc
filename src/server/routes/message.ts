import { Hono } from 'hono'
import type { SessionManager } from '../sessionManager.js'
import { notFound } from '../errors.js'
import {
  readSessionMessages,
  readSessionTodos,
  readSessionTasks,
  readSessionDiff,
  type SessionMessage,
  type TaskInfo,
  type MessagePart,
  decomposeMessageToParts,
} from '../transcriptReader.js'
import { getSubagentProgress } from '../sessionMessageRouter.js'

function findParentCwd(sessionManager: SessionManager, id: string): string | undefined {
  for (const handle of sessionManager.getAllSessions()) {
    if (handle.activeSubagents.has(id)) {
      return handle.spawnCwd ?? handle.cwd
    }
  }
  return undefined
}

function patchActiveSubagentsInMessages(
  messages: SessionMessage[],
  activeSubagents: ReadonlyMap<string, { agentId: string; toolUseId?: string }>,
): void {
  if (activeSubagents.size === 0) return

  const runningCallIDs = new Set<string>()
  const progressByCallID = new Map<string, string[]>()

  for (const [, info] of activeSubagents) {
    if (info.toolUseId) {
      runningCallIDs.add(info.toolUseId)
      const progress = getSubagentProgress(info.agentId)
      if (progress?.progressLines?.length) {
        progressByCallID.set(info.toolUseId, progress.progressLines)
      }
    }
  }

  if (runningCallIDs.size === 0) return

  for (const msg of messages) {
    if (!Array.isArray(msg.parts)) continue
    for (const part of msg.parts) {
      if (part.type !== 'tool') continue
      const toolPart = part as MessagePart & { type: 'tool'; callID: string; state: Record<string, unknown> }
      if (!runningCallIDs.has(toolPart.callID)) continue
      toolPart.state = {
        ...toolPart.state,
        status: 'running',
        progress: progressByCallID.get(toolPart.callID) ?? [],
        time: { start: (toolPart.state as any).time?.start ?? Date.now() },
      } as any
    }
  }
}

function dedupeMessages(disk: SessionMessage[], memory: SessionMessage[]): SessionMessage[] {
  if (disk.length === 0) return memory
  const diskUuids = new Set(disk.map(m => m.uuid))
  const tail = memory.filter(m => !diskUuids.has(m.uuid))
  return [...disk, ...tail]
}

export function createMessageRoutes(sessionManager: SessionManager): Hono {
  return new Hono()
    .get('/session/:sessionID/message', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      const parentCwd = handle ? undefined : findParentCwd(sessionManager, id)
      const effectiveCwd = handle?.spawnCwd ?? handle?.cwd ?? parentCwd

      const url = new URL(c.req.url)
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
      const before = url.searchParams.get('before') ?? undefined
      const includeSystem = url.searchParams.get('include_system') === 'true'

      const { messages: diskMessages, nextCursor } = await readSessionMessages({
        sessionId: id,
        cwd: effectiveCwd,
        limit,
        before,
        includeSystem,
      })

      const messages = handle && handle.messageBuffer.length > 0
        ? dedupeMessages(diskMessages, [...handle.messageBuffer])
        : diskMessages

      const tombstoned = handle?.tombstonedUuids
      const filtered = tombstoned && tombstoned.size > 0
        ? messages.filter(m => !tombstoned.has(m.uuid))
        : messages

      const decomposed = filtered.map(decomposeMessageToParts)

      if (handle) {
        patchActiveSubagentsInMessages(decomposed, handle.activeSubagents)
      }

      const result = decomposed

      if (nextCursor) {
        c.header('Link', `<${url.pathname}?limit=${limit}&before=${nextCursor}>; rel="prev"`)
        c.header('X-Next-Cursor', nextCursor)
      }

      return c.json({ messages: result })
    })
    .get('/session/:sessionID/todo', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)

      const todos = await readSessionTodos({
        sessionId: id,
        cwd: handle?.spawnCwd ?? handle?.cwd,
      })

      return c.json({ todos })
    })
    .get('/session/:sessionID/tasks', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)

      const tasks = await readSessionTasks({
        sessionId: id,
        cwd: handle?.spawnCwd ?? handle?.cwd,
      })

      return c.json({ tasks })
    })
    .get('/session/:sessionID/diff', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)

      const url = new URL(c.req.url)
      const messageID = url.searchParams.get('messageID') ?? undefined

      const { diffs } = await readSessionDiff({
        sessionId: id,
        cwd: handle?.spawnCwd ?? handle?.cwd,
        messageID,
      })

      return c.json({ diffs })
    })
}
