import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { SessionManager } from '../sessionManager.js'
import { getScriptArgsForChild } from '../sessionHandle.js'
import {
  badRequest,
  notFound,
  tooManySessions,
  sessionError,
  conflict,
} from '../errors.js'

function ssePrompt(
  handle: import('../sessionHandle.js').SessionHandle,
  id: string,
  content: string,
  c: import('hono').Context,
) {
  return streamSSE(c, async stream => {
    const startTime = Date.now()
    let resultWritten = false
    let pendingWrite: Promise<void> = Promise.resolve()

    const unsub = handle.onMessage(msg => {
      if (resultWritten) return
      if (msg.type === 'result') {
        resultWritten = true
        const info = handle.getInfo()
        pendingWrite = pendingWrite.then(() =>
          stream.writeSSE({
            event: 'result',
            data: JSON.stringify({
              ...msg,
              session_id: id,
              cost_usd: info.cost_usd,
              duration_ms: Date.now() - startTime,
            }),
          }),
        )
        unsub()
      } else if (
        msg.type === 'assistant' ||
        msg.type === 'tool_progress'
      ) {
        pendingWrite = pendingWrite.then(() =>
          stream.writeSSE({
            event: 'message',
            data: JSON.stringify({ ...msg, session_id: id }),
          }),
        )
      } else if (msg.type === 'control_request') {
        pendingWrite = pendingWrite.then(() =>
          stream.writeSSE({
            event: 'control_request',
            data: JSON.stringify({ ...msg, session_id: id }),
          }),
        )
      } else if (msg.type === 'system') {
        pendingWrite = pendingWrite.then(() =>
          stream.writeSSE({
            event: 'system',
            data: JSON.stringify({ ...msg, session_id: id }),
          }),
        )
      }
    })

    stream.onAbort(() => {
      unsub()
    })

    try {
      await handle.prompt(content)
    } catch {
      if (!resultWritten) {
        pendingWrite = pendingWrite.then(() =>
          stream.writeSSE({
            event: 'result',
            data: JSON.stringify({
              type: 'result',
              subtype: 'error_during_execution',
              session_id: id,
              duration_ms: Date.now() - startTime,
            }),
          }),
        )
      }
    }

    await pendingWrite

    if (!resultWritten) {
      await stream.writeSSE({
        event: 'result',
        data: JSON.stringify({
          type: 'result',
          subtype: 'success',
          session_id: id,
          duration_ms: Date.now() - startTime,
        }),
      })
    }

    await stream.sleep(50)
  })
}

export function createSessionRoutes(
  sessionManager: SessionManager,
): Hono {
  return new Hono()
    .post('/session', async c => {
      const body = await c.req.json<{
        cwd?: string
        permission_mode?: string
        permission?: Array<{ permission: string; pattern: string; action: string }>
        model?: string
        system_prompt?: string
        resume_session_id?: string
        resume_session_at?: string
        hooks?: Record<string, unknown>
      }>()

      let permissionMode = body.permission_mode
      if (!permissionMode && body.permission) {
        const hasDeny = body.permission.some(r => r.action === 'deny')
        const hasAsk = body.permission.some(r => r.action === 'ask')
        if (!hasDeny && !hasAsk) {
          permissionMode = 'bypassPermissions'
        } else if (hasAsk) {
          permissionMode = 'default'
        }
      }

      try {
        const handle = await sessionManager.createSession({
          cwd: body.cwd,
          model: body.model,
          permissionMode,
          systemPrompt: body.system_prompt,
          resumeSessionId: body.resume_session_id,
          resumeSessionAt: body.resume_session_at,
          hooks: body.hooks,
          execPath: process.execPath,
          scriptArgs: getScriptArgsForChild(),
        })

        const info = handle.getInfo()
        return c.json(
          {
            session_id: handle.sessionId,
            status: handle.status,
            cwd: handle.cwd,
            created_at: info.created_at,
          },
          201,
        )
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Failed to create session'
        if (msg.includes('Maximum concurrent')) {
          throw tooManySessions(msg)
        }
        throw sessionError(msg)
      }
    })
    .get('/session', c => {
      const url = new URL(c.req.url)
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)

      const handles = sessionManager.getAllSessions()
      const sessions = handles
        .slice(offset, offset + limit)
        .map(h => h.getInfo())

      return c.json({ sessions })
    })
    .get('/session/status', c => {
      return c.json({ sessions: sessionManager.getSessionStatuses() })
    })
    .get('/session/:sessionID', c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (!handle) throw notFound('session not found')
      const info = handle.getInfo()
      return c.json({
        ...info,
        message_count: handle.messageCount,
        usage: handle.usage,
      })
    })
    .patch('/session/:sessionID', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (!handle) throw notFound('session not found')

      const body = await c.req.json<{
        title?: string
        model?: string
        permission_mode?: string
      }>()

      if (body.title) handle.setTitle(body.title)
      if (body.model) await handle.setModel(body.model)
      if (body.permission_mode) await handle.setPermissionMode(body.permission_mode)

      return c.json({
        session_id: id,
        title: handle.title ?? body.title,
        model: handle.model,
        permission_mode: handle.permissionMode,
      })
    })
    .delete('/session/:sessionID', async c => {
      const id = c.req.param('sessionID')
      const deleted = await sessionManager.deleteSession(id)
      if (!deleted) throw notFound('session not found')
      return c.json({ deleted: true })
    })
    .post('/session/:sessionID/prompt', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (!handle) throw notFound('session not found')

      const body = await c.req.json<{
        content?: string
        parts?: Array<{ type: string; text?: string }>
        files?: string[]
        images?: unknown[]
        model?: { providerID?: string; modelID?: string }
      }>()

      const content = body.content ?? body.parts
        ?.filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text)
        .join('\n') ?? ''
      if (!content) throw badRequest('content is required')
      if (handle.prompting) throw conflict('session is already processing a prompt')

      if (body.model?.modelID) {
        try { await handle.setModel(body.model.modelID) } catch {}
      }

      return ssePrompt(handle, id, content, c)
    })
    .post('/session/:sessionID/prompt_async', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (!handle) throw notFound('session not found')

      const body = await c.req.json<{
        content?: string
        parts?: Array<{ type: string; text?: string }>
        files?: string[]
        images?: unknown[]
        model?: { providerID?: string; modelID?: string }
      }>()

      const content = body.content ?? body.parts
        ?.filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text)
        .join('\n') ?? ''
      if (!content) throw badRequest('content is required')
      if (handle.prompting) throw conflict('session is already processing a prompt')

      void (async () => {
        if (body.model?.modelID) {
          try { await handle.setModel(body.model.modelID) } catch {}
        }
        handle.prompt(content).catch(() => {})
      })()

      return new Response(null, { status: 204 })
    })
    .post('/session/:sessionID/abort', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (!handle) throw notFound('session not found')
      await handle.abort()
      return c.json({ aborted: true })
    })
    .post('/session/:sessionID/shell', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (!handle) throw notFound('session not found')

      const body = await c.req.json<{ command: string }>()
      if (!body.command) throw badRequest('command is required')
      return ssePrompt(handle, id, body.command, c)
    })
    .post('/session/:sessionID/command', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (!handle) throw notFound('session not found')

      const body = await c.req.json<{ command: string }>()
      if (!body.command) throw badRequest('command is required')
      return ssePrompt(handle, id, body.command, c)
    })
}
