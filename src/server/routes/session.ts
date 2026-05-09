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
import { listSessionsImpl } from '../../utils/listSessionsImpl.js'

async function getOrCreateSession(
  sessionManager: SessionManager,
  id: string,
): Promise<import('../sessionHandle.js').SessionHandle> {
  const existing = sessionManager.getSession(id)
  if (existing) return existing

  try {
    const handle = await sessionManager.createSession({
      resumeSessionId: id,
      execPath: process.execPath,
      scriptArgs: getScriptArgsForChild(),
    })
    await handle.start()
    return handle
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create session'
    if (msg.includes('Maximum concurrent')) {
      throw tooManySessions(msg)
    }
    if (msg.includes('Working directory does not exist')) {
      throw sessionError(msg)
    }
    throw notFound('session not found')
  }
}

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

      const headerDir = c.req.header('x-csc-directory')
        || c.req.header('x-opencode-directory')
      const cwd = body.cwd
        || (headerDir ? decodeURIComponent(headerDir) : undefined)

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
          cwd,
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
    .get('/session', async c => {
      const url = new URL(c.req.url)
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
      // 优先从请求头 x-csc-directory 取工作目录（cs-cloud 通过此头传递），
      // fallback 到 query string 的 dir 参数
      const headerDir = c.req.header('x-csc-directory')
      const dir = (headerDir ? decodeURIComponent(headerDir) : undefined)
        ?? url.searchParams.get('dir')
        ?? undefined
      // roots=true 时只返回没有 parentID 的顶层 session（csc 无 parent 概念，全部视为 root）
      // const rootsOnly = url.searchParams.get('roots') === 'true'

      // 从磁盘读取历史 session 列表
      let historySessions: Awaited<ReturnType<typeof listSessionsImpl>> = []
      try {
        historySessions = await listSessionsImpl({ dir, limit: limit + offset })
        process.stderr.write(`[server:session] listSessionsImpl dir=${dir ?? 'all'} found=${historySessions.length}\n`)
      } catch (err) {
        process.stderr.write(`[server:session] listSessionsImpl error: ${err}\n`)
      }

      // 内存中活跃的 handle，用于覆盖运行时状态
      const handleMap = new Map(
        sessionManager.getAllSessions().map(h => [h.sessionId, h])
      )

      // 把磁盘历史会话转成统一格式，如果内存中有对应 handle 则合并运行时字段
      const merged = historySessions.map(s => {
        const handle = handleMap.get(s.sessionId)
        const info = handle?.getInfo()
        return {
          session_id: s.sessionId,
          status: info?.status ?? 'stopped',
          cwd: info?.cwd ?? s.cwd ?? '',
          title: (info?.title ?? s.customTitle ?? s.firstPrompt ?? s.summary) ?? '',
          model: info?.model,
          permission_mode: info?.permission_mode,
          created_at: s.createdAt ?? info?.created_at ?? 0,
          last_active_at: s.lastModified ?? info?.last_active_at ?? 0,
          cost_usd: info?.cost_usd ?? 0,
          input_tokens: info?.input_tokens ?? 0,
          output_tokens: info?.output_tokens ?? 0,
        }
      })

      // 补充内存中有但磁盘还没落盘的活跃 session（刚创建还没写过消息的）
      const historyIds = new Set(historySessions.map(s => s.sessionId))
      for (const handle of sessionManager.getAllSessions()) {
        if (!historyIds.has(handle.sessionId)) {
          const info = handle.getInfo()
          merged.push({ ...info, title: info.title ?? '' })
        }
      }

      // 过滤掉已知的无意义管理命令会话（用户直接输入后立即退出，没有实际对话内容）
      const BORING_COMMANDS = new Set([
        '/exit', '/quit', '/bye',
        '/clear', '/reset',
        '/model', '/models',
        '/login', '/logout',
        '/help', '/version',
        '/compact',
      ])
      const filtered = merged.filter(s => {
        const t = s.title.trim()
        if (!t) return false
        if (BORING_COMMANDS.has(t)) return false
        return true
      })

      // 按最后活跃时间倒序
      filtered.sort((a, b) => (b.last_active_at ?? 0) - (a.last_active_at ?? 0))

      const sessions = filtered.slice(offset, offset + limit)
      process.stderr.write(`[server:session] GET /session -> history=${historySessions.length} active=${handleMap.size} merged=${merged.length} returned=${sessions.length}\n`)
      return c.json({ sessions })
    })
    .get('/session/status', async c => {
      // 内存中活跃 session 的状态
      const activeStatuses = sessionManager.getSessionStatuses()

      // 从请求头或 query 取目录过滤
      const headerDir = c.req.header('x-csc-directory')
      const statusDir = (headerDir ? decodeURIComponent(headerDir) : undefined)
        ?? c.req.query('dir')
        ?? undefined

      // 补充磁盘历史 session（全部视为 idle）
      let historySessions: Awaited<ReturnType<typeof listSessionsImpl>> = []
      try {
        historySessions = await listSessionsImpl({ dir: statusDir, limit: 200 })
      } catch {}

      const sessions: Record<string, { status: string; state: string; has_pending_permission: boolean; type: string }> = {}

      // 先把历史 session 全部标为 idle/stopped
      for (const s of historySessions) {
        sessions[s.sessionId] = {
          status: 'stopped',
          state: 'stopped',
          has_pending_permission: false,
          type: 'idle',
        }
      }

      // 用内存中活跃的 handle 状态覆盖
      for (const [id, st] of Object.entries(activeStatuses)) {
        sessions[id] = {
          status: st.status,
          state: st.status,
          has_pending_permission: st.has_pending_permission,
          type: st.status === 'running' ? 'busy' : 'idle',
        }
      }

      return c.json({ sessions })
    })
    .get('/session/:sessionID', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (handle) {
        const info = handle.getInfo()
        return c.json({
          ...info,
          message_count: handle.messageCount,
          usage: handle.usage,
        })
      }

      // 内存中没有，从磁盘历史记录查找
      try {
        const history = await listSessionsImpl({ limit: 1000 })
        const s = history.find(h => h.sessionId === id)
        if (s) {
          return c.json({
            session_id: s.sessionId,
            status: 'stopped',
            cwd: s.cwd ?? '',
            title: (s.customTitle ?? s.firstPrompt ?? s.summary) ?? '',
            model: undefined,
            permission_mode: undefined,
            created_at: s.createdAt ?? 0,
            last_active_at: s.lastModified ?? 0,
            cost_usd: 0,
            input_tokens: 0,
            output_tokens: 0,
            message_count: 0,
            usage: { input_tokens: 0, output_tokens: 0 },
          })
        }
      } catch {}

      throw notFound('session not found')
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
      const handle = await getOrCreateSession(sessionManager, id)

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

      const handle = await getOrCreateSession(sessionManager, id)

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
      if (!content) {
        throw badRequest('content is required')
      }
      if (handle.prompting) {
        throw conflict('session is already processing a prompt')
      }

      void (async () => {
        try {
          if (handle.status !== 'running') {
            await handle.waitReady()
          }
          if (body.model?.modelID) {
            try { await handle.setModel(body.model.modelID) } catch {}
          }
          handle.prompt(content).catch(() => {})
        } catch {}
      })()

      return c.json({ ok: true }, 200)
    })
    .post('/session/:sessionID/abort', async c => {
      const id = c.req.param('sessionID')
      const handle = await getOrCreateSession(sessionManager, id)
      await handle.abort()
      return c.json({ aborted: true })
    })
    .post('/session/:sessionID/shell', async c => {
      const id = c.req.param('sessionID')
      const handle = await getOrCreateSession(sessionManager, id)

      const body = await c.req.json<{ command: string }>()
      if (!body.command) throw badRequest('command is required')
      return ssePrompt(handle, id, body.command, c)
    })
    .post('/session/:sessionID/command', async c => {
      const id = c.req.param('sessionID')
      const handle = await getOrCreateSession(sessionManager, id)

      const body = await c.req.json<{ command: string }>()
      if (!body.command) throw badRequest('command is required')
      return ssePrompt(handle, id, body.command, c)
    })
    .post('/session/:sessionID/command_async', async c => {
      const id = c.req.param('sessionID')
      const handle = await getOrCreateSession(sessionManager, id)

      const body = await c.req.json<{ command: string }>()
      if (!body.command) throw badRequest('command is required')
      if (handle.prompting) throw conflict('session is already processing a prompt')

      handle.prompt(body.command).catch(() => {})

      return new Response(null, { status: 204 })
    })
    .post('/session/:sessionID/revert', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (!handle) throw notFound('session not found')
      return c.json(handle.getInfo())
    })
    .post('/session/:sessionID/summarize', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (!handle) throw notFound('session not found')
      return c.json({ ok: true })
    })
}
