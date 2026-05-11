import { type ChildProcess, spawn } from 'child_process'
import { createInterface } from 'readline'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { logError } from '../utils/log.js'
import type { EventBus } from './eventBus.js'
import { INIT_TIMEOUT_MS, getScriptArgsForChild, loadChildSpawnPrefix } from './childSpawn.js'
import { ControlChannel } from './sessionControlChannel.js'
import { routeMessage, type StdoutMessage, type MessageRouterCtx } from './sessionMessageRouter.js'
import type { SessionBusyStatus, SessionState, InitData, PendingPermission, PendingQuestion } from './types.js'

export type { InitData, PendingPermission, PendingQuestion }
export { getScriptArgsForChild }
export { getChildSpawnArgs, saveChildSpawnPrefix } from './childSpawn.js'

type MessageListener = (msg: StdoutMessage) => void

export type SessionHandleOptions = {
  sessionId: string
  cwd: string
  model?: string
  permissionMode?: string
  systemPrompt?: string
  resumeSessionId?: string
  resumeSessionAt?: string
  hooks?: Record<string, unknown>
  eventBus: EventBus
  execPath: string
  scriptArgs: string[]
  verbose?: boolean
  silent?: boolean
  onInit?: (data: InitData) => void
}

export class SessionHandle {
  readonly sessionId: string
  readonly cwd: string
  private _spawnCwd: string | undefined
  private child: ChildProcess | null = null
  private _status: SessionState = 'starting'
  private _busyStatus: SessionBusyStatus = { type: 'idle' }
  private _model?: string
  private _providerId?: string
  private _permissionMode?: string
  private _title?: string
  private _costUsd = 0
  private _inputTokens = 0
  private _outputTokens = 0
  private createdAt = Date.now()
  private lastActiveAt = Date.now()
  private eventBus: EventBus
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingQuestions = new Map<string, PendingQuestion>()
  private promptResolve:
    | ((value: { done: boolean; error?: string }) => void)
    | null = null
  private promptReject: ((reason: unknown) => void) | null = null
  private verbose: boolean
  private lastStderr: string[] = []
  private listeners = new Set<MessageListener>()
  private _initData: InitData | null = null
  private initRequestId: string | null = null
  private initResolve: ((data: InitData) => void) | null = null
  private initReject: ((reason: unknown) => void) | null = null
  private _prompting = false
  private _lastMessageUuid: string | null = null
  private _controlChannel = new ControlChannel()

  get status(): SessionState {
    return this._status
  }
  get busyStatus(): SessionBusyStatus {
    return this._busyStatus
  }
  get model(): string | undefined {
    return this._model
  }
  get permissionMode(): string | undefined {
    return this._permissionMode
  }
  get title(): string | undefined {
    return this._title
  }
  get costUsd(): number {
    return this._costUsd
  }
  get inputTokens(): number {
    return this._inputTokens
  }
  get messageCount(): number {
    return 0
  }
  get usage() {
    return {
      input_tokens: this._inputTokens,
      output_tokens: this._outputTokens,
    }
  }
  get initData(): InitData | null {
    return this._initData
  }
  get prompting(): boolean {
    return this._prompting
  }

  get lastMessageUuid(): string | null {
    return this._lastMessageUuid
  }

  get ready(): boolean {
    return this._status === 'running'
  }

  get silent(): boolean {
    return this.opts.silent ?? false
  }

  get spawnCwd(): string {
    return this._spawnCwd ?? this.cwd
  }

  async waitReady(timeoutMs = INIT_TIMEOUT_MS): Promise<void> {
    if (this._status === 'running') return
    if (this._status === 'stopped') {
      throw new Error(`Session ${this.sessionId} is stopped`)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Session ${this.sessionId} init timed out`))
      }, timeoutMs)
      const origResolve = this.initResolve
      const origReject = this.initReject
      this.initResolve = (data: InitData) => {
        clearTimeout(timer)
        origResolve?.(data)
        resolve()
      }
      this.initReject = (err: unknown) => {
        clearTimeout(timer)
        origReject?.(err)
        reject(err)
      }
    })
  }

  constructor(private opts: SessionHandleOptions) {
    this.sessionId = opts.sessionId
    this.cwd = opts.cwd
    this.eventBus = opts.eventBus
    this._model = opts.model
    this._permissionMode = opts.permissionMode ?? 'acceptEdits'
    this.verbose = opts.verbose ?? false
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  spawn(): void {
    const printArgs = [
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      ...(this.opts.resumeSessionId ? [] : ['--session-id', this.sessionId]),
      ...(this.opts.model ? ['--model', this.opts.model] : []),
      '--permission-mode',
      this._permissionMode,
      '--permission-prompt-tool',
      'stdio',
      ...(this.opts.resumeSessionId
        ? ['--resume', this.opts.resumeSessionId]
        : []),
      ...(this.opts.resumeSessionAt
        ? ['--resume-session-at', this.opts.resumeSessionAt]
        : []),
      '--verbose',
    ]

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CSC_SERVE_MODE: '1',
    }

    if (this.opts.systemPrompt) {
      env.CLAUDE_CODE_SYSTEM_PROMPT = this.opts.systemPrompt
    }

    const saved = loadChildSpawnPrefix()
    const defineArgs = saved?.defineArgs ?? []
    const featureArgs = saved?.featureArgs ?? []
    const spawnArgs = [...defineArgs, ...featureArgs, ...this.opts.scriptArgs, ...printArgs.filter((x): x is string => x != null)]

    this._spawnCwd = this.opts.cwd
    this.child = spawn(this.opts.execPath, spawnArgs, {
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    })

    this.setupStdout()
    this.setupStderr()

    this.child!.on('close', (code, signal) => {
      if (this._status !== 'stopped') {
        this._status = 'stopped'
        this._busyStatus = { type: 'idle' }
        this.emitBusyStatus()
        this.emitEvent('deleted', {
          status: 'stopped',
          exit_code: code,
          signal: signal ?? null,
        })
      }
      if (this.initReject) {
        const reject = this.initReject
        this.initResolve = null
        this.initReject = null
        process.stderr.write(`[serve:${this.sessionId}] exit_code=${code} cwd=${this.cwd} stderr:\n${this.lastStderr.slice(-5).join('\n')}\n`)
        reject(new Error(`Process exited with code ${code}`))
      }
      if (this.promptReject) {
        this.promptReject(new Error(`Process exited with code ${code}`))
      }
    })

    this.child!.on('error', err => {
      logError(err)
      this._status = 'stopped'
      this._busyStatus = { type: 'idle' }
      this.emitBusyStatus()
      if (this.initReject) {
        const reject = this.initReject
        this.initResolve = null
        this.initReject = null
        reject(err)
      }
      if (this.promptReject) {
        this.promptReject(err)
      }
    })

    this.initRequestId = crypto.randomUUID()
    this.sendInitialize()

    const timeout = setTimeout(() => {
      if (this.initReject) {
        const reject = this.initReject
        this.initResolve = null
        this.initReject = null
        this._status = 'stopped'
        this.emitEvent('deleted', {
          status: 'stopped',
          reason: 'init_timeout',
        })
        reject(new Error(`Session ${this.sessionId} init timed out`))
      }
    }, INIT_TIMEOUT_MS)

    this.initResolve = (data: InitData) => {
      clearTimeout(timeout)
      this.initReject = null
    }
    this.initReject = (_err: unknown) => {
      clearTimeout(timeout)
      this.initResolve = null
    }
  }

  async start(): Promise<void> {
    if (!this.child) {
      this.spawn()
    }
    if (this._status === 'running') return
    return new Promise((resolve, reject) => {
      const origResolve = this.initResolve
      const origReject = this.initReject
      this.initResolve = (data: InitData) => {
        origResolve?.(data)
        resolve()
      }
      this.initReject = (err: unknown) => {
        origReject?.(err)
        reject(err)
      }
    })
  }

  private sendInitialize(): void {
    const request: Record<string, unknown> = {
      subtype: 'initialize',
    }
    if (this.opts.hooks) {
      request.hooks = this.opts.hooks
    }
    const msg = jsonStringify({
      type: 'control_request',
      request_id: this.initRequestId,
      request,
    })
    this.writeStdin(msg)
  }

  private setupStdout(): void {
    if (!this.child?.stdout) return
    const rl = createInterface({ input: this.child.stdout })
    rl.on('line', line => {
      if (!line.trim()) return
      let msg: StdoutMessage
      try {
        msg = jsonParse(line) as StdoutMessage
      } catch {
        return
      }
      routeMessage(msg, this.createRouterCtx())
    })
  }

  private setupStderr(): void {
    if (!this.child?.stderr) return
    const rl = createInterface({ input: this.child.stderr })
    rl.on('line', line => {
      if (this.verbose) {
        process.stderr.write(`[serve:${this.sessionId}] ${line}\n`)
      }
      if (this.lastStderr.length >= 20) {
        this.lastStderr.shift()
      }
      this.lastStderr.push(line)
    })
  }

  private emitEvent(event: string, data: Record<string, unknown>): void {
    if (this.opts.silent) return
    this.eventBus.publishSessionEvent(this.sessionId, event, data)
  }

  private emitOpencodeEvent(event: string, properties: Record<string, unknown>): void {
    if (this.opts.silent) return
    if (properties.type === event && 'properties' in properties) {
      this.eventBus.publish(event, properties as Record<string, unknown>)
      return
    }
    this.eventBus.publish(event, {
      session_id: properties.sessionID,
      ...properties,
    })
  }

  private emitBusyStatus(): void {
    if (this.opts.silent) return
    this.eventBus.publish('session.status', {
      sessionID: this.sessionId,
      status: this._busyStatus,
    })
  }

  private emitMessage(msg: StdoutMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(msg)
      } catch {}
    }
  }

  private writeStdin(data: string): void {
    if (this.child?.stdin && !this.child.stdin.destroyed) {
      const flushed = this.child.stdin.write(data + '\n')
      if (!flushed) {
        this.child.stdin.once('drain', () => {})
      }
    }
  }

  private createRouterCtx(): MessageRouterCtx {
    return {
      sessionId: this.sessionId,
      silent: this.opts.silent ?? false,
      getStatus: () => this._status,
      getBusyStatus: () => this._busyStatus,
      getModel: () => this._model,
      getProviderId: () => this._providerId,
      getInitRequestId: () => this.initRequestId,
      getLastMessageUuid: () => this._lastMessageUuid,
      setStatus: (s) => { this._status = s },
      setBusyStatus: (s) => { this._busyStatus = s },
      setModel: (m) => { this._model = m },
      setProviderId: (id) => { this._providerId = id },
      setInitData: (d) => { this._initData = d },
      setLastMessageUuid: (u) => { this._lastMessageUuid = u },
      setLastActiveAt: (t) => { this.lastActiveAt = t },
      addCost: (c) => { this._costUsd += c },
      addInputTokens: (t) => { this._inputTokens += t },
      addOutputTokens: (t) => { this._outputTokens += t },
      getControlChannel: () => this._controlChannel,
      getPendingPermissions: () => this.pendingPermissions,
      getPendingQuestions: () => this.pendingQuestions,
      resolveInit: (data) => {
        const resolve = this.initResolve
        this.initResolve = null
        this.initReject = null
        resolve?.(data)
        this.opts.onInit?.(data)
      },
      resolvePrompt: (value) => {
        this._busyStatus = { type: 'idle' }
        this.emitBusyStatus()
        if (this.promptResolve) {
          this.promptResolve(value)
          this.promptResolve = null
          this.promptReject = null
        }
      },
      emitEvent: (event, data) => this.emitEvent(event, data),
      emitOpencodeEvent: (event, props) => this.emitOpencodeEvent(event, props),
      emitBusyStatus: () => this.emitBusyStatus(),
      emitMessage: (msg) => this.emitMessage(msg),
      writeStdin: (data) => this.writeStdin(data),
    }
  }

  setTitle(title: string): void {
    this._title = title
  }

  async sendControlRequest(
    request: Record<string, unknown>,
    timeoutMs = 10000,
  ): Promise<Record<string, unknown>> {
    const requestId = crypto.randomUUID()
    this.writeStdin(
      jsonStringify({
        type: 'control_request',
        request_id: requestId,
        request,
      }),
    )
    return this._controlChannel.register(requestId, timeoutMs)
  }

  async setModel(model: string): Promise<void> {
    this._model = model
    await this.sendControlRequest({ subtype: 'set_model', model })
  }

  async setPermissionMode(mode: string): Promise<void> {
    this._permissionMode = mode
    await this.sendControlRequest({ subtype: 'set_permission_mode', mode })
  }

  async getMcpStatus(): Promise<unknown[]> {
    const response = await this.sendControlRequest({ subtype: 'mcp_status' })
    return (response.mcpServers as unknown[]) ?? []
  }

  async prompt(content: string, _opts?: { parts?: Array<Record<string, unknown>> }): Promise<{ done: boolean; error?: string }> {
    if (this._status === 'stopped') {
      throw new Error(
        `Session ${this.sessionId} is stopped`,
      )
    }
    if (this._status !== 'running') {
      await this.waitReady()
    }
    if (this._prompting) {
      throw new Error(
        `Session ${this.sessionId} is already processing a prompt`,
      )
    }
    this._prompting = true
    this._busyStatus = { type: 'busy' }
    this.emitBusyStatus()
    this.lastActiveAt = Date.now()

    const userMsg = jsonStringify({
      type: 'user',
      content,
      uuid: crypto.randomUUID(),
      session_id: this.sessionId,
      message: { role: 'user', content },
      parent_tool_use_id: null,
    })

    this.emitEvent('message', {
      type: 'user',
      content,
      session_id: this.sessionId,
      model: this._model ?? '',
      provider_id: this._providerId ?? '',
    })

    this.writeStdin(userMsg)

    return new Promise((resolve, reject) => {
      this.promptResolve = (value) => {
        this._prompting = false
        resolve(value)
      }
      this.promptReject = (reason) => {
        this._prompting = false
        reject(reason)
      }
    })
  }

  async abort(): Promise<void> {
    if (!this.child || this.child.killed) return

    const interrupt = jsonStringify({
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'interrupt' },
    })
    this.writeStdin(interrupt)

    this._busyStatus = { type: 'idle' }
    this.emitBusyStatus()

    if (!this.promptResolve) return

    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        this.kill()
        resolve()
      }, 2000)
      const originalResolve = this.promptResolve
      this.promptResolve = (value) => {
        clearTimeout(timeout)
        originalResolve?.(value)
        resolve()
      }
    })
  }

  replyPermission(
    requestId: string,
    behavior: 'allow' | 'deny',
    opts?: {
      updatedInput?: Record<string, unknown>
      updatedPermissions?: Record<string, unknown>[]
      message?: string
      interrupt?: boolean
      decisionClassification?: string
    },
  ): void {
    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response:
          behavior === 'allow'
            ? {
                behavior: 'allow',
                updatedInput: opts?.updatedInput ?? {},
                ...(opts?.updatedPermissions
                  ? { updatedPermissions: opts.updatedPermissions }
                  : {}),
                ...(opts?.decisionClassification
                  ? { decisionClassification: opts.decisionClassification }
                  : {}),
              }
            : {
                behavior: 'deny',
                message: opts?.message ?? 'Denied',
                ...(opts?.interrupt ? { interrupt: true } : {}),
              },
      },
    }
    this.writeStdin(jsonStringify(response))
    const perm = this.getPendingPermission(requestId)
    const toolName = perm?.toolName
    this.pendingPermissions.delete(requestId)
    this.emitEvent('permission_replied', {
      request_id: requestId,
      behavior,
    })
    if (toolName === 'AskUserQuestion') {
      const eventType = behavior === 'allow' ? 'question.replied' : 'question.rejected'
      this.emitOpencodeEvent(eventType, {
        sessionID: this.sessionId,
        requestID: requestId,
      })
    } else {
      this.emitOpencodeEvent('permission.replied', {
        sessionID: this.sessionId,
        requestID: requestId,
      })
    }
  }

  replyQuestion(
    requestId: string,
    action: 'accept' | 'decline',
    content?: Record<string, unknown>,
  ): void {
    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response:
          action === 'accept'
            ? { action: 'accept', content }
            : { action: 'decline' },
      },
    }
    this.writeStdin(jsonStringify(response))
    this.pendingQuestions.delete(requestId)
    this.emitEvent('question_replied', {
      request_id: requestId,
      action,
    })
    const eventType = action === 'accept' ? 'question.replied' : 'question.rejected'
    this.emitOpencodeEvent(eventType, {
      sessionID: this.sessionId,
      requestID: requestId,
    })
  }

  kill(): void {
    if (this.child && !this.child.killed) {
      if (process.platform === 'win32') {
        this.child.kill()
      } else {
        this.child.kill('SIGTERM')
      }
    }
    this._status = 'stopped'
    this._controlChannel.rejectAll(new Error('Session killed'))
  }

  forceKill(): void {
    if (this.child && !this.child.killed) {
      if (process.platform === 'win32') {
        this.child.kill()
      } else {
        this.child.kill('SIGKILL')
      }
    }
    this._status = 'stopped'
    this._controlChannel.rejectAll(new Error('Session force killed'))
  }

  getPendingPermissions(): PendingPermission[] {
    return [...this.pendingPermissions.values()]
  }

  getPendingPermission(requestId: string): PendingPermission | undefined {
    return this.pendingPermissions.get(requestId)
  }

  getPendingQuestions(): PendingQuestion[] {
    return [...this.pendingQuestions.values()]
  }

  getPendingQuestion(requestId: string): PendingQuestion | undefined {
    return this.pendingQuestions.get(requestId)
  }

  getLastStderr(): string[] {
    return [...this.lastStderr]
  }

  getInfo() {
    return {
      id: this.sessionId,
      session_id: this.sessionId,
      slug: this.sessionId,
      projectID: '',
      directory: this.cwd,
      cwd: this.cwd,
      title: this._title,
      version: '',
      time: {
        created: this.createdAt,
        updated: this.lastActiveAt,
      },
      status: this._status,
      model: this._model,
      permission_mode: this._permissionMode,
      created_at: this.createdAt,
      last_active_at: this.lastActiveAt,
      cost_usd: this._costUsd,
      input_tokens: this._inputTokens,
      output_tokens: this._outputTokens,
      last_message_uuid: this._lastMessageUuid,
    }
  }
}
