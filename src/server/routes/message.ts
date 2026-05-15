import { Hono } from 'hono'
import type { SessionManager } from '../sessionManager.js'
import { notFound } from '../errors.js'
import {
  readSessionMessages,
  readSessionTodos,
  readSessionDiff,
  type SessionMessage,
} from '../transcriptReader.js'

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

      const url = new URL(c.req.url)
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
      const before = url.searchParams.get('before') ?? undefined
      const includeSystem = url.searchParams.get('include_system') === 'true'

      const { messages: diskMessages, nextCursor } = await readSessionMessages({
        sessionId: id,
        cwd: handle?.spawnCwd ?? handle?.cwd,
        limit,
        before,
        includeSystem,
      })

      const messages = handle && handle.messageBuffer.length > 0
        ? dedupeMessages(diskMessages, [...handle.messageBuffer])
        : diskMessages

      if (nextCursor) {
        c.header('Link', `<${url.pathname}?limit=${limit}&before=${nextCursor}>; rel="prev"`)
        c.header('X-Next-Cursor', nextCursor)
      }

      return c.json({ messages })
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
