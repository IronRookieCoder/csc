import { Hono } from 'hono'
import type { SessionManager } from '../sessionManager.js'
import { notFound } from '../errors.js'
import {
  readSessionMessages,
  readSessionTodos,
  readSessionDiff,
} from '../transcriptReader.js'

export function createMessageRoutes(sessionManager: SessionManager): Hono {
  return new Hono()
    .get('/session/:sessionID/message', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)

      const url = new URL(c.req.url)
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
      const before = url.searchParams.get('before') ?? undefined
      const includeSystem = url.searchParams.get('include_system') === 'true'

      const { messages, nextCursor } = await readSessionMessages({
        sessionId: id,
        cwd: handle?.cwd,
        limit,
        before,
        includeSystem,
      })

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
        cwd: handle?.cwd,
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
        cwd: handle?.cwd,
        messageID,
      })

      return c.json({ diffs })
    })
}
