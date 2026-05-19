import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { SessionManager } from '../sessionManager.js'
import type { EventBus } from '../eventBus.js'
import { getScriptArgsForChild } from '../childSpawn.js'
import {
  badRequest,
  notFound,
  tooManySessions,
  sessionError,
  conflict,
} from '../errors.js'
import { listSessionsImpl } from '../../utils/listSessionsImpl.js'
import { canonicalizePath } from '../../utils/sessionStoragePortable.js'
import { buildHooksForPermissionMode, mergeHooks } from '../../utils/permissions/permissionModeHooks.js'
import { permissionModeFromString } from '../../utils/permissions/PermissionMode.js'

/** 从磁盘历史记录查找 session 的原始 cwd，用于 resume 时恢复正确的工作目录 */
async function getHistoryCwd(sessionId: string): Promise<string | undefined> {
  try {
    const list = await listSessionsImpl({ limit: 1000 })
    return list.find(s => s.sessionId === sessionId)?.cwd
  } catch {
    return undefined
  }
}

function ssePrompt(
  handle: import('../sessionHandle.js').SessionHandle,
  id: string,
  content: string,
  c: import('hono').Context,
  parts?: Array<Record<string, unknown>>,
  messageID?: string,
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
      await handle.prompt(content, { parts, messageID })
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
  eventBus: EventBus,
): Hono {
  async function getOrResumeSession(id: string): Promise<import('../sessionHandle.js').SessionHandle> {
    const handle = sessionManager.getSession(id)
    if (handle) return handle

    const cwd = await getHistoryCwd(id)
    try {
      const resumed = await sessionManager.createSession({
        cwd,
        sessionId: id,
        resumeSessionId: id,
        execPath: process.execPath,
        scriptArgs: getScriptArgsForChild(),
      })
      await resumed.waitReady(30000)
      return resumed
    } catch (err) {
      throw sessionError(err instanceof Error ? err.message : 'Failed to resume session')
    }
  }

  return new Hono()
    .post('/session', async c => {
      const body = await c.req.json<{
        cwd?: string
        session_id?: string
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
        let hooks = body.hooks
        if (permissionMode) {
          const resolvedMode = permissionModeFromString(permissionMode)
          const autoHooks = buildHooksForPermissionMode(resolvedMode)
          hooks = mergeHooks(autoHooks, body.hooks)
        }

        const handle = await sessionManager.createSession({
          cwd,
          sessionId: body.session_id,
          model: body.model,
          permissionMode,
          systemPrompt: body.system_prompt,
          resumeSessionId: body.resume_session_id,
          resumeSessionAt: body.resume_session_at,
          hooks,
          execPath: process.execPath,
          scriptArgs: getScriptArgsForChild(),
        })

        // 不阻塞等待 ready：子进程冷启动可能 >30s 撞上反代超时；prompt() 内部已有 waitReady 兜底
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
      const headerDir = c.req.header('x-csc-directory')
      const dir = (headerDir ? decodeURIComponent(headerDir) : undefined)
        ?? url.searchParams.get('dir')
        ?? undefined

      const canonicalDir = dir ? await canonicalizePath(dir).catch(() => dir) : undefined

      // 从磁盘读取历史 session 列表
      let historySessions: Awaited<ReturnType<typeof listSessionsImpl>> = []
      try {
        historySessions = await listSessionsImpl({ dir, limit: limit + offset })
      } catch {}

      // 内存中活跃的 handle，用于覆盖运行时状态
      const handleMap = new Map(
        sessionManager.getAllSessions().map(h => [h.sessionId, h])
      )

      // 把磁盘历史会话转成统一格式，如果内存中有对应 handle 则合并运行时字段
      const merged = historySessions.map(s => {
        const handle = handleMap.get(s.sessionId)
        const info = handle?.getInfo()
        return {
          id: s.sessionId,
          session_id: s.sessionId,
          slug: info?.slug ?? s.sessionId,
          projectID: info?.projectID ?? '',
          status: info?.status ?? 'stopped',
          directory: info?.directory ?? s.cwd ?? '',
          cwd: info?.cwd ?? s.cwd ?? '',
          title: (info?.title ?? s.customTitle ?? s.firstPrompt ?? s.summary) ?? '',
          version: info?.version ?? '',
          time: info?.time ?? {
            created: s.createdAt ?? 0,
            updated: s.lastModified ?? 0,
          },
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
          if (canonicalDir) {
            const handleCwd = await canonicalizePath(handle.cwd).catch(() => handle.cwd)
            if (handleCwd !== canonicalDir) continue
          }
          const info = handle.getInfo()
          merged.push({ ...info, title: info.title ?? '' })
        }
      }

      // Pre-canonicalize all session cwds for consistent cwd filtering
      const cwdCache = new Map<string, string>()
      const getCwd = async (p: string) => {
        const hit = cwdCache.get(p)
        if (hit !== undefined) return hit
        const c = await canonicalizePath(p).catch(() => p)
        cwdCache.set(p, c)
        return c
      }

      // Filter by cwd to prevent cross-workspace leakage
      const cwdFiltered: typeof merged = []
      for (const s of merged) {
        if (canonicalDir) {
          const sessionCwd = s.cwd ?? s.directory ?? ''
          if (sessionCwd) {
            const c = await getCwd(sessionCwd)
            if (c !== canonicalDir) continue
          } else {
            continue
          }
        }
        cwdFiltered.push(s)
      }

      const BORING_COMMANDS = new Set([
        '/exit', '/quit', '/bye',
        '/clear', '/reset',
        '/model', '/models',
        '/login', '/logout',
        '/help', '/version',
        '/compact',
      ])
      const filtered = cwdFiltered.filter(s => {
        const t = s.title.trim()
        if (!t) return false
        if (BORING_COMMANDS.has(t)) return false
        return true
      })

      // 按最后活跃时间倒序
      filtered.sort((a, b) => (b.last_active_at ?? 0) - (a.last_active_at ?? 0))

      const sessions = filtered.slice(offset, offset + limit)
      return c.json(sessions)
    })
    .get('/session/status', async c => {
      const headerDir = c.req.header('x-csc-directory')
      const dir = headerDir ? decodeURIComponent(headerDir) : undefined
      const activeCount = sessionManager.getActiveCount()
      const indexCount = sessionManager.getLoadedIndexCount()
      const statuses = await sessionManager.getSessionStatuses(dir)
      process.stderr.write(`[status] dir=${dir ?? '(none)'} active=${activeCount} index=${indexCount} result=${JSON.stringify(statuses)}\n`)
      return c.json(statuses)
    })
    .get('/session/:sessionID', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (handle) {
        const info = handle.getInfo()
        return c.json({
          ...info,
          busy_status: handle.getEffectiveBusyStatus(),
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
            id: s.sessionId,
            session_id: s.sessionId,
            slug: s.sessionId,
            projectID: '',
            status: 'stopped',
            directory: s.cwd ?? '',
            cwd: s.cwd ?? '',
            title: (s.customTitle ?? s.firstPrompt ?? s.summary) ?? '',
            version: '',
            time: {
              created: s.createdAt ?? 0,
              updated: s.lastModified ?? 0,
            },
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

      const body = await c.req.json<{
        title?: string
        model?: string
        permission_mode?: string
        time?: { archived?: number }
      }>()

      if (handle) {
        if (body.title) handle.setTitle(body.title)
        if (body.model) await handle.setModel(body.model)
        if (body.permission_mode) await handle.setPermissionMode(body.permission_mode)
      }

      return c.json({
        session_id: id,
        title: handle?.title ?? body.title,
        model: handle?.model,
        permission_mode: handle?.permissionMode,
      })
    })
    .delete('/session/:sessionID', async c => {
      const id = c.req.param('sessionID')
      const deleted = sessionManager.deleteSession(id)
      if (!deleted) throw notFound('session not found')
      return c.json({ deleted: true })
    })
    .post('/session/:sessionID/prompt', async c => {
      const id = c.req.param('sessionID')
      const handle = await getOrResumeSession(id)

      const body = await c.req.json<{
        content?: string
        parts?: Array<Record<string, unknown>>
        files?: string[]
        images?: unknown[]
        model?: { providerID?: string; modelID?: string }
        agent?: string
        messageID?: string
      }>()

      const textContent = body.content ?? body.parts
        ?.filter((p): p is Record<string, unknown> & { type: string; text?: string } => p.type === 'text' && !!(p as { text?: string }).text)
        .map((p) => (p as { text: string }).text)
        .join('\n') ?? ''

      const agentParts = body.parts?.filter((p) => p.type === 'agent' && p.name) ?? []
      // Agent switching is handled via setAgent() control message below.
      // Do not append @agent-* mentions to content — they are REPL-only syntax
      // and would be sent verbatim to the model in server mode.
      const content = textContent

      if (!content) throw badRequest('content is required')
      if (handle.prompting) throw conflict('session is already processing a prompt')

      if (body.model?.modelID) {
        try { await handle.setModel(body.model.modelID) } catch {}
      }
      const effectiveAgent = body.agent ?? (agentParts[0] as Record<string, unknown> | undefined)?.name as string | undefined
      if (effectiveAgent && effectiveAgent !== handle.agent) {
        try { await handle.setAgent(effectiveAgent) } catch {}
      }

      return ssePrompt(handle, id, content, c, body.parts, body.messageID)
    })
    .post('/session/:sessionID/prompt_async', async c => {
      const tEntry = Date.now()
      const id = c.req.param('sessionID')

      // Parse body FIRST — independent of session lookup, so we can
      // emit busy status immediately even for historical sessions that
      // need to create+waitReady (3–30s).
      const body = await c.req.json<{
        content?: string
        parts?: Array<Record<string, unknown>>
        files?: string[]
        images?: unknown[]
        model?: { providerID?: string; modelID?: string }
        agent?: string
        messageID?: string
      }>()

      const textContent = body.content ?? body.parts
        ?.filter((p): p is Record<string, unknown> & { type: string; text?: string } => p.type === 'text' && !!(p as { text?: string }).text)
        .map((p) => (p as { text: string }).text)
        .join('\n') ?? ''

      const agentParts = body.parts?.filter((p) => p.type === 'agent' && p.name) ?? []
      // Agent switching is handled via setAgent() control message below.
      // Do not append @agent-* mentions to content — they are REPL-only syntax
      // and would be sent verbatim to the model in server mode.
      const content = textContent

      if (!content) {
        throw badRequest('content is required')
      }

      // Emit busy IMMEDIATELY — before session recovery or child-process
      // init. Aligned with OpenCode: status.set fires in the request
      // handler synchronously, not after waiting for the child process.
      eventBus.publish('session.status', {
        sessionID: id,
        status: { type: 'busy' },
      })

      let handle = sessionManager.getSession(id)

      if (!handle) {
        try {
          handle = await getOrResumeSession(id)
        } catch (err) {
          eventBus.publish('session.status', {
            sessionID: id,
            status: { type: 'idle' },
          })
          throw err
        }
      } else if (handle.prompting) {
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
          const effectiveAgent = body.agent ?? (agentParts[0] as Record<string, unknown> | undefined)?.name as string | undefined
          if (effectiveAgent && effectiveAgent !== handle.agent) {
            try { await handle.setAgent(effectiveAgent) } catch {}
          }
          handle.prompt(content, { parts: body.parts, messageID: body.messageID }).catch(() => {})

        } catch {}
      })()

      return c.json({ ok: true }, 200)
    })
    .post('/session/:sessionID/abort', async c => {
      const id = c.req.param('sessionID')
      const handle = sessionManager.getSession(id)
      if (!handle) {
        // Even when no in-memory handle exists, emit idle status so that
        // a prior prompt_async busy event (which fires before the handle
        // is created) is not left dangling forever.
        eventBus.publish('session.status', {
          sessionID: id,
          status: { type: 'idle' },
        })
        return c.json({ aborted: true })
      }
      await handle.abort()
      return c.json({ aborted: true })
    })
    .post('/session/:sessionID/shell', async c => {
      const id = c.req.param('sessionID')
      const handle = await getOrResumeSession(id)

      const body = await c.req.json<{ command: string }>()
      if (!body.command) throw badRequest('command is required')
      return ssePrompt(handle, id, body.command, c)
    })
    .post('/session/:sessionID/command', async c => {
      const t0 = Date.now()
      const id = c.req.param('sessionID')

      const body = await c.req.json<{ command: string; arguments?: string; agent?: string; model?: string }>()
      if (!body.command) throw badRequest('command is required')

      const cmdParts = '/' + [body.command, body.arguments].filter(Boolean).join(' ')

      eventBus.publish('session.status', {
        sessionID: id,
        status: { type: 'busy' },
      })

      let handle = sessionManager.getSession(id)

      if (!handle) {
        void (async () => {
          try {
            handle = await getOrResumeSession(id)

            if (body.agent && body.agent !== handle.agent) {
              try { await handle.setAgent(body.agent) } catch {}
            }
            if (body.model) {
              const modelID = body.model.includes('/') ? body.model.split('/').slice(1).join('/') : body.model
              try { await handle.setModel(modelID) } catch {}
            }

            handle.prompt(cmdParts).catch(() => {})
          } catch (err) {
            eventBus.publish('session.status', {
              sessionID: id,
              status: { type: 'idle' },
            })
          }
        })()

        return c.json({ ok: true }, 200)
      }

      if (body.agent && body.agent !== handle.agent) {
        try { await handle.setAgent(body.agent) } catch {}
      }
      if (body.model) {
        const modelID = body.model.includes('/') ? body.model.split('/').slice(1).join('/') : body.model
        try { await handle.setModel(modelID) } catch {}
      }

      handle.prompt(cmdParts).catch(() => {})

      return c.json({ ok: true }, 200)
    })
    .post('/session/:sessionID/command_async', async c => {
      const id = c.req.param('sessionID')
      const handle = await getOrResumeSession(id)

      const body = await c.req.json<{ command: string }>()
      if (!body.command) throw badRequest('command is required')
      if (handle.prompting) throw conflict('session is already processing a prompt')

      eventBus.publish('session.status', {
        sessionID: id,
        status: { type: 'busy' },
      })

      handle.prompt(body.command).catch(() => {})

      return c.json({ ok: true }, 200)
    })
    .post('/session/:sessionID/revert', async c => {
      const id = c.req.param('sessionID')
      const handle = await getOrResumeSession(id)
      return c.json(handle.getInfo())
    })
    .post('/session/:sessionID/summarize', async c => {
      const id = c.req.param('sessionID')
      const handle = await getOrResumeSession(id)
      return c.json({ ok: true })
    })
}
