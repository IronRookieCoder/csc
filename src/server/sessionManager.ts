import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync, statSync } from 'fs'
import { join, resolve, isAbsolute } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { logError } from '../utils/log.js'
import type { EventBus } from './eventBus.js'
import { SessionHandle, type InitData } from './sessionHandle.js'
import type { SessionIndex, SessionIndexEntry, SessionState } from './types.js'

const INDEX_FILE = 'server-sessions.json'

export class SessionManager {
  private sessions = new Map<string, SessionHandle>()
  private loadedIndex = new Map<string, SessionIndexEntry>()
  private eventBus: EventBus
  private maxSessions: number
  private idleTimeoutMs: number
  private defaultWorkspace?: string
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null
  private indexDirty = false
  private _cachedInitData: InitData | null = null
  private _initDataReady: Promise<void> | null = null
  private _resolveInitDataReady: (() => void) | null = null
  private _probeHandle: SessionHandle | null = null

  constructor(opts: {
    eventBus: EventBus
    maxSessions?: number
    idleTimeoutMs?: number
    workspace?: string
  }) {
    this.eventBus = opts.eventBus
    this.maxSessions = opts.maxSessions ?? 32
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 1800000
    this.defaultWorkspace = opts.workspace
  }

  async init(): Promise<void> {
    await this.loadIndex()
    this.startIdleCheck()
  }

  private getIndexPath(): string {
    return join(getClaudeConfigHomeDir(), INDEX_FILE)
  }

  private async loadIndex(): Promise<void> {
    const path = this.getIndexPath()
    if (!existsSync(path)) return
    try {
      const raw = await readFile(path, 'utf-8')
      const index: SessionIndex = JSON.parse(raw)
      for (const [key, entry] of Object.entries(index)) {
        this.loadedIndex.set(key, entry)
      }
    } catch (err) {
      logError(err as Error)
    }
  }

  private async saveIndex(): Promise<void> {
    const index: SessionIndex = {}
    for (const [key, handle] of this.sessions) {
      const info = handle.getInfo()
      index[key] = {
        sessionId: handle.sessionId,
        transcriptSessionId: handle.sessionId,
        cwd: handle.cwd,
        permissionMode: info.permission_mode,
        createdAt: info.created_at,
        lastActiveAt: info.last_active_at,
      }
    }
    const dir = getClaudeConfigHomeDir()
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    try {
      await writeFile(this.getIndexPath(), JSON.stringify(index, null, 2))
    } catch (err) {
      logError(err as Error)
    }
  }

  private scheduleIndexSave(): void {
    if (this.indexDirty) return
    this.indexDirty = true
    setTimeout(async () => {
      this.indexDirty = false
      await this.saveIndex()
    }, 1000)
  }

  private startIdleCheck(): void {
    if (this.idleTimeoutMs <= 0) return
    const checkInterval = Math.min(this.idleTimeoutMs / 2, 60000)
    this.idleCheckInterval = setInterval(() => {
      const now = Date.now()
      for (const [id, handle] of this.sessions) {
        const info = handle.getInfo()
        if (
          info.status === 'running' &&
          now - info.last_active_at > this.idleTimeoutMs!
        ) {
          handle.kill()
          this.eventBus.publishSessionEvent(id, 'deleted', {
            status: 'stopped',
            reason: 'idle_timeout',
          })
          this.sessions.delete(id)
          this.scheduleIndexSave()
        }
      }
    }, checkInterval)
  }

  getActiveCount(): number {
    return this.sessions.size
  }

  getSession(id: string): SessionHandle | undefined {
    return this.sessions.get(id)
  }

  getAllSessions(): SessionHandle[] {
    return [...this.sessions.values()]
  }

  getSessionStatuses(): Record<
    string,
    { status: SessionState; has_pending_permission: boolean; prompting: boolean }
  > {
    const result: Record<
      string,
      { status: SessionState; has_pending_permission: boolean; prompting: boolean }
    > = {}
    for (const [id, handle] of this.sessions) {
      result[id] = {
        status: handle.status,
        has_pending_permission: handle.getPendingPermissions().length > 0,
        prompting: handle.prompting,
      }
    }
    return result
  }

  async createSession(opts: {
    cwd?: string
    model?: string
    permissionMode?: string
    systemPrompt?: string
    resumeSessionId?: string
    resumeSessionAt?: string
    hooks?: Record<string, unknown>
    execPath: string
    scriptArgs: string[]
    silent?: boolean
  }): Promise<SessionHandle> {
    if (this.maxSessions > 0 && this.sessions.size >= this.maxSessions) {
      throw new Error(
        `Maximum concurrent sessions reached (${this.maxSessions})`,
      )
    }

    const sessionId = crypto.randomUUID()
    let cwd = opts.cwd || this.defaultWorkspace || process.cwd()
    if (!isAbsolute(cwd)) {
      cwd = resolve(process.cwd(), cwd)
    }
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      throw new Error(`Working directory does not exist: ${cwd}`)
    }

    const handle = new SessionHandle({
      sessionId,
      cwd,
      model: opts.model,
      permissionMode: opts.permissionMode,
      systemPrompt: opts.systemPrompt,
      resumeSessionId: opts.resumeSessionId,
      resumeSessionAt: opts.resumeSessionAt,
      hooks: opts.hooks,
      eventBus: this.eventBus,
      execPath: opts.execPath,
      scriptArgs: opts.scriptArgs,
      silent: opts.silent,
      onInit: (data) => {
        this._cachedInitData = data
        this._resolveInitDataReady?.()
      },
    })

    this.sessions.set(sessionId, handle)
    if (!opts.silent) {
      this.eventBus.publishSessionEvent(sessionId, 'created', {
        status: 'starting',
      })
    }
    this.scheduleIndexSave()

    try {
      handle.spawn()
    } catch (err) {
      this.sessions.delete(sessionId)
      this.scheduleIndexSave()
      throw err
    }

    return handle
  }

  getCachedInitData(): InitData | null {
    if (this._cachedInitData) return this._cachedInitData
    for (const handle of this.sessions) {
      if (handle[1].initData) return handle[1].initData
    }
    return null
  }

  waitForInitData(timeoutMs = 30000): Promise<void> {
    if (this._cachedInitData) return Promise.resolve()
    return this._initDataReady ?? Promise.resolve()
  }

  startProbeSession(opts: {
    cwd?: string
    execPath: string
    scriptArgs: string[]
  }): void {
    this._initDataReady = new Promise(resolve => {
      this._resolveInitDataReady = resolve
    })

    void (async () => {
      try {
        const probe = await this.createSession({
          cwd: opts.cwd,
          execPath: opts.execPath,
          scriptArgs: opts.scriptArgs,
          silent: true,
        })
        this._probeHandle = probe
        await probe.start()
        await this.deleteSession(probe.sessionId)
        this._probeHandle = null
      } catch (err) {
        this._probeHandle?.forceKill()
        this._probeHandle = null
      }
      this._resolveInitDataReady?.()
    })()
  }

  killProbe(): void {
    if (this._probeHandle) {
      this._probeHandle.forceKill()
      this._probeHandle = null
    }
    this._resolveInitDataReady?.()
  }

  async deleteSession(id: string): Promise<boolean> {
    const handle = this.sessions.get(id)
    if (!handle) return false
    const silent = handle.silent
    handle.forceKill()
    this.sessions.delete(id)
    if (!silent) {
      this.eventBus.publishSessionEvent(id, 'deleted', { status: 'stopped' })
    }
    this.scheduleIndexSave()
    return true
  }

  async destroyAll(): Promise<void> {
    for (const [, handle] of this.sessions) {
      handle.forceKill()
    }
    this.sessions.clear()
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
    }
    await this.saveIndex()
  }

  getAllPendingPermissions(): Array<{
    requestId: string
    sessionId: string
    toolName: string
    toolUseId: string
    input: Record<string, unknown>
    title: string
    description: string
  }> {
    const result: Array<{
      requestId: string
      sessionId: string
      toolName: string
      toolUseId: string
      input: Record<string, unknown>
      title: string
      description: string
    }> = []
    for (const [, handle] of this.sessions) {
      result.push(...handle.getPendingPermissions())
    }
    return result
  }

  getAllPendingQuestions(): Array<{
    requestId: string
    sessionId: string
    mcpServerName: string
    message: string
    mode: string
    requestedSchema: Record<string, unknown>
  }> {
    const result: Array<{
      requestId: string
      sessionId: string
      mcpServerName: string
      message: string
      mode: string
      requestedSchema: Record<string, unknown>
    }> = []
    for (const [, handle] of this.sessions) {
      result.push(...handle.getPendingQuestions())
    }
    return result
  }

  findPermissionAcrossSessions(
    requestId: string,
  ): { handle: SessionHandle; perm: import('./sessionHandle.js').PendingPermission } | null {
    for (const [, handle] of this.sessions) {
      const perm = handle.getPendingPermission(requestId)
      if (perm) return { handle, perm }
    }
    return null
  }

  findQuestionAcrossSessions(
    requestId: string,
  ): { handle: SessionHandle; question: import('./sessionHandle.js').PendingQuestion } | null {
    for (const [, handle] of this.sessions) {
      const question = handle.getPendingQuestion(requestId)
      if (question) return { handle, question }
    }
    return null
  }
}
