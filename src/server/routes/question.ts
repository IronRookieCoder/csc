import { Hono } from 'hono'
import type { SessionManager } from '../sessionManager.js'
import { notFound } from '../errors.js'

export function createQuestionRoutes(sessionManager: SessionManager): Hono {
  return new Hono()
    .get('/question', c => {
      const questions = sessionManager.getAllPendingQuestions()
      return c.json({ questions })
    })
    .post('/question/:requestID/reply', async c => {
      const requestId = c.req.param('requestID')
      const found = sessionManager.findQuestionAcrossSessions(requestId)
      if (!found) throw notFound('question request not found')

      const body = await c.req.json<{
        action: 'accept'
        content?: Record<string, unknown>
      }>()

      found.handle.replyQuestion(requestId, body.action, body.content)
      return c.json({ resolved: true })
    })
    .post('/question/:requestID/reject', async c => {
      const requestId = c.req.param('requestID')
      const found = sessionManager.findQuestionAcrossSessions(requestId)
      if (!found) throw notFound('question request not found')

      found.handle.replyQuestion(requestId, 'decline')
      return c.json({ resolved: true })
    })
}
