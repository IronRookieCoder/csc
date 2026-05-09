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
        behavior?: 'allow' | 'deny' | 'once' | 'always' | 'reject'
        updated_input?: Record<string, unknown>
        updated_permissions?: Record<string, unknown>[]
        message?: string
        interrupt?: boolean
      }>()

      const isAlways = body.behavior === 'always'

      const mappedBehavior: 'allow' | 'deny' =
        body.behavior === 'reject' ? 'deny' :
        body.behavior === 'once' || body.behavior === 'always' ? 'allow' :
        body.behavior === 'deny' ? 'deny' : 'allow'

      const updatedPermissions = body.updated_permissions
        ?? (isAlways ? found.perm.suggestions : undefined)

      found.handle.replyPermission(requestId, mappedBehavior, {
        updatedInput: body.updated_input ?? {},
        updatedPermissions,
        message: body.message,
        interrupt: body.interrupt,
        decisionClassification: isAlways ? 'user_permanent' : mappedBehavior === 'allow' ? 'user_temporary' : undefined,
      })

      return c.json({ resolved: true })
    })
}
