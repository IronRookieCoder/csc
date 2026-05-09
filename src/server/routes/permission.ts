import { Hono } from 'hono'
import type { SessionManager } from '../sessionManager.js'
import { notFound } from '../errors.js'

const TOOL_NAME_TO_PERMISSION: Record<string, string> = {
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

function extractPatterns(input: Record<string, unknown>): string[] {
  const patterns: string[] = []
  for (const key of ['file_path', 'path', 'pattern', 'glob'] as const) {
    const v = typeof input[key] === 'string' ? input[key] as string : ''
    if (v) patterns.push(v)
  }
  const cmd = typeof input.command === 'string' ? input.command as string : ''
  if (cmd) patterns.push(cmd)
  return patterns
}

function toPermissionKey(toolName: string): string {
  return TOOL_NAME_TO_PERMISSION[toolName] ?? toolName.toLowerCase()
}

function formatPermission(perm: {
  requestId: string
  sessionId: string
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
}) {
  return {
    id: perm.requestId,
    sessionID: perm.sessionId,
    permission: toPermissionKey(perm.toolName),
    patterns: extractPatterns(perm.input),
    metadata: { input: perm.input },
    always: [] as string[],
    tool: {
      messageID: '',
      callID: perm.toolUseId,
    },
  }
}

export function createPermissionRoutes(sessionManager: SessionManager): Hono {
  return new Hono()
    .get('/permission', c => {
      const permissions = sessionManager.getAllPendingPermissions()
      return c.json({ permissions: permissions.map(formatPermission) })
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
