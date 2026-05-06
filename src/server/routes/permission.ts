import { Hono } from 'hono'
import type { SessionManager } from '../sessionManager.js'
import { notFound } from '../errors.js'

export function createPermissionRoutes(sessionManager: SessionManager): Hono {
  return new Hono()
    .get('/permission', c => {
      const permissions = sessionManager.getAllPendingPermissions()
      return c.json({ permissions })
    })
    .post('/permission/:requestID/reply', async c => {
      const requestId = c.req.param('requestID')
      const found = sessionManager.findPermissionAcrossSessions(requestId)
      if (!found) throw notFound('permission request not found')

      const body = await c.req.json<{
        behavior: 'allow' | 'deny'
        updated_input?: Record<string, unknown>
        message?: string
      }>()

      found.handle.replyPermission(requestId, body.behavior, {
        updatedInput: body.updated_input,
        message: body.message,
      })

      return c.json({ resolved: true })
    })
}
