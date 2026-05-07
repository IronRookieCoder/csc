import { type ChildProcess, spawn } from 'child_process'
import { createInterface } from 'readline'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { logError } from '../utils/log.js'
import type { EventBus } from './eventBus.js'
import type { SessionState } from './types.js'

type StdoutMessage = {
  type: string
  [key: string]: unknown
}

type MessageListener = (msg: StdoutMessage) => void

export type InitData = {
  commands?: Array<{ name: string; description: string; argumentHint?: string }>
  agents?: Array<{ name: string; description?: string; model?: string }>
  models?: unknown
  account?: {
    email?: string
    organization?: string
    subscriptionType?: string
    tokenSource?: string
    apiKeySource?: string
    apiProvider?: string
  }
  output_style?: string
  available_output_styles?: string[]
  pid?: number
}

export type PendingPermission = {
  requestId: string
  sessionId: string
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
  title: string
  description: string
}

export type PendingQuestion = {
  requestId: string
  sessionId: string
  mcpServerName: string
  message: string
  mode: string
  requestedSchema: Record<string, unknown>
}

export type SessionHandleOptions = {
  sessionId: string
  cwd: string
  model?: string
  permissionMode?: string
  systemPrompt?: string
  resumeSessionId?: string
  eventBus: EventBus
  execPath: string
  scriptArgs: string[]
  verbose?: boolean
}

export function getScriptArgsForChild(): string[] {
  const argv1 = process.argv[1]
  if (!argv1) return []
  if (argv1.endsWith('.ts') || argv1.endsWith('.tsx') || argv1.includes('/') || argv1.includes('\\')) {
    return [argv1]
  }
  return []
}

export function getChildSpawnArgs(): { execPath: string; scriptArgs: string[] } {
  const execPath = process.execPath
  const scriptArgs = getScriptArgsForChild()
  return { execPath, scriptArgs }
}

export async function saveChildSpawnPrefix(): Promise<void> {
  if (process.env._CSC_CHILD_SPAWN_PREFIX) return
  const { execPath, scriptArgs } = getChildSpawnArgs()
  let defineArgs: string[] = []
  let featureArgs: string[] = []
  try {
    const definesMod = await import('../../scripts/defines.js') as { getMacroDefines: () => Record<string, string>; DEFAULT_BUILD_FEATURES: readonly string[] }
    const defines = definesMod.getMacroDefines()
    defineArgs = Object.entries(defines).flatMap(([k, v]) => ['-d', `${k}:${v}`])
    const features = definesMod.DEFAULT_BUILD_FEATURES
    featureArgs = features.flatMap((f: string) => ['--feature', f])
  } catch {}
  const envFeatures = Object.entries(process.env)
    .filter(([k]) => k.startsWith('FEATURE_') && k.slice(8))
    .map(([k]) => ['--feature', k.slice(8)] as [string, string])
    .flat()
  const allFeatureArgs = [...featureArgs, ...envFeatures]
  const prefix = JSON.stringify({ execPath, scriptArgs, defineArgs, featureArgs: allFeatureArgs })
  process.env._CSC_CHILD_SPAWN_PREFIX = prefix
}

function loadChildSpawnPrefix(): { execPath: string; scriptArgs: string[]; defineArgs?: string[]; featureArgs?: string[] } | null {
  const raw = process.env._CSC_CHILD_SPAWN_PREFIX
  if (!raw) return null
  try {
    return JSON.parse(raw) as { execPath: string; scriptArgs: string[]; defineArgs?: string[]; featureArgs?: string[] }
  } catch {
    return null
  }
}

export class SessionHandle {
  readonly sessionId: string
  readonly cwd: string
  private child: ChildProcess | null = null
  private _status: SessionState = 'starting'
  private _model?: string
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
  private _prompting = false

  get status(): SessionState {
    return this._status
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

  constructor(private opts: SessionHandleOptions) {
    this.sessionId = opts.sessionId
    this.cwd = opts.cwd
    this.eventBus = opts.eventBus
    this._model = opts.model
    this._permissionMode = opts.permissionMode
    this.verbose = opts.verbose ?? false
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async start(): Promise<void> {
    const printArgs = [
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--session-id',
      this.sessionId,
      ...(this.opts.model ? ['--model', this.opts.model] : []),
      ...(this.opts.permissionMode
        ? ['--permission-mode', this.opts.permissionMode]
        : []),
      ...(this.opts.resumeSessionId
        ? ['--resume', this.opts.resumeSessionId]
        : []),
      '--verbose',
    ]

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    }

    if (this.opts.systemPrompt) {
      env.CLAUDE_CODE_SYSTEM_PROMPT = this.opts.systemPrompt
    }

    const saved = loadChildSpawnPrefix()
    const defineArgs = saved?.defineArgs ?? []
    const featureArgs = saved?.featureArgs ?? []
    const spawnArgs = [...defineArgs, ...featureArgs, ...this.opts.scriptArgs, ...printArgs]

    this.child = spawn(this.opts.execPath, spawnArgs, {
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    })

    this.setupStdout()
    this.setupStderr()

    this.child.on('close', (code, signal) => {
      if (this._status !== 'stopped') {
        this._status = 'stopped'
        this.eventBus.publishSessionEvent(this.sessionId, 'deleted', {
          status: 'stopped',
          exit_code: code,
          signal: signal ?? null,
        })
      }
      if (this.initResolve) {
        this.initResolve = null
      }
      if (this.promptReject) {
        this.promptReject(new Error(`Process exited with code ${code}`))
      }
    })

    this.child.on('error', err => {
      logError(err)
      this._status = 'stopped'
      if (this.initResolve) {
        this.initResolve = null
      }
      if (this.promptReject) {
        this.promptReject(err)
      }
    })

    this.initRequestId = crypto.randomUUID()
    const initPromise = new Promise<InitData>((resolve, reject) => {
      this.initResolve = resolve
      const timeout = setTimeout(() => {
        this.initResolve = null
        reject(new Error('Init handshake timed out (30s)'))
      }, 30000)
      const originalResolve = resolve
      this.initResolve = (data: InitData) => {
        clearTimeout(timeout)
        originalResolve(data)
      }
    })

    this.sendInitialize()

    try {
      this._initData = await initPromise
    } catch (err) {
      this._status = 'stopped'
      throw err
    }

    this._status = 'running'
    this.lastActiveAt = Date.now()
    this.eventBus.publishSessionEvent(this.sessionId, 'ready', {
      status: 'running',
      model: this._model,
    })
  }

  private sendInitialize(): void {
    const msg = jsonStringify({
      type: 'control_request',
      request_id: this.initRequestId,
      request: {
        subtype: 'initialize',
      },
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
      this.routeMessage(msg)
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

  private emitMessage(msg: StdoutMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(msg)
      } catch {}
    }
  }

  private routeMessage(msg: StdoutMessage): void {
    if (
      this._status === 'starting' &&
      msg.type === 'control_response' &&
      this.initResolve
    ) {
      const response = msg.response as Record<string, unknown> | undefined
      if (response?.subtype === 'success' && response?.request_id === this.initRequestId) {
        const initData = (response.response ?? {}) as InitData
        this._initData = initData
        if (Array.isArray(initData.models) && initData.models.length > 0 && !this._model) {
          const first = (initData.models as Array<Record<string, string>>)[0]
          this._model = first?.value ?? first?.name
        }
        this.initResolve(initData)
        this.initResolve = null
        return
      }
    }

    if (msg.type === 'control_response') {
      const response = msg.response as Record<string, unknown> | undefined
      const requestId = response?.request_id as string | undefined
      if (requestId && this.pendingControlResponses.has(requestId)) {
        const pending = this.pendingControlResponses.get(requestId)!
        this.pendingControlResponses.delete(requestId)
        clearTimeout(pending.timeout)
        if (response?.subtype === 'error') {
          pending.reject(new Error((response.error as string) ?? 'Unknown error'))
        } else {
          pending.resolve((response?.response ?? {}) as Record<string, unknown>)
        }
        return
      }
    }

    this.emitMessage(msg)

    switch (msg.type) {
      case 'system': {
        this.eventBus.publishSessionEvent(this.sessionId, 'message', msg)
        break
      }
      case 'assistant': {
        this.lastActiveAt = Date.now()
        this._status = 'running'
        this.eventBus.publishSessionEvent(this.sessionId, 'message', msg)
        break
      }
      case 'result': {
        this.lastActiveAt = Date.now()
        this._status = 'running'
        const cost = msg.cost_usd as number | undefined
        const usage = msg.usage as
          | { input_tokens?: number; output_tokens?: number }
          | undefined
        if (cost) this._costUsd += cost
        if (usage?.input_tokens) this._inputTokens += usage.input_tokens
        if (usage?.output_tokens) this._outputTokens += usage.output_tokens
        this.eventBus.publishSessionEvent(this.sessionId, 'result', msg)
        if (this.promptResolve) {
          this.promptResolve({ done: true })
          this.promptResolve = null
          this.promptReject = null
        }
        break
      }
      case 'control_request': {
        const request = msg.request as Record<string, unknown> | undefined
        const requestId = msg.request_id as string
        if (request?.subtype === 'can_use_tool') {
          const perm: PendingPermission = {
            requestId,
            sessionId: this.sessionId,
            toolName: (request.tool_name as string) ?? 'Unknown',
            toolUseId: (request.tool_use_id as string) ?? '',
            input: (request.input as Record<string, unknown>) ?? {},
            title: `${request.tool_name}: ${JSON.stringify(request.input).slice(0, 80)}`,
            description: `Execute ${request.tool_name}`,
          }
          this.pendingPermissions.set(requestId, perm)
          this.eventBus.publishSessionEvent(
            this.sessionId,
            'control_request',
            { request_id: requestId, request },
          )
        } else if (request?.subtype === 'elicitation') {
          const question: PendingQuestion = {
            requestId,
            sessionId: this.sessionId,
            mcpServerName: (request.mcp_server_name as string) ?? '',
            message: (request.message as string) ?? '',
            mode: (request.mode as string) ?? 'form',
            requestedSchema:
              (request.requested_schema as Record<string, unknown>) ?? {},
          }
          this.pendingQuestions.set(requestId, question)
          this.eventBus.publishSessionEvent(
            this.sessionId,
            'control_request',
            { request_id: requestId, request },
          )
        }
        break
      }
      default: {
        this.eventBus.publishSessionEvent(this.sessionId, 'message', msg)
        break
      }
    }
  }

  private _outputTokens = 0
  private pendingControlResponses = new Map<
    string,
    {
      resolve: (response: Record<string, unknown>) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()

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
    return this.waitForControlResponse(requestId, timeoutMs)
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

  private waitForControlResponse(
    requestId: string,
    timeoutMs = 10000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingControlResponses.delete(requestId)
        reject(new Error(`Control response timed out for ${requestId}`))
      }, timeoutMs)
      this.pendingControlResponses.set(requestId, { resolve, reject, timeout })
    })
  }

  async prompt(content: string): Promise<{ done: boolean; error?: string }> {
    if (this._status !== 'running') {
      throw new Error(
        `Session ${this.sessionId} is not running (status: ${this._status})`,
      )
    }
    if (this._prompting) {
      throw new Error(
        `Session ${this.sessionId} is already processing a prompt`,
      )
    }
    this._prompting = true
    this.lastActiveAt = Date.now()

    const userMsg = jsonStringify({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.sessionId,
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

    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        this.kill()
        resolve()
      }, 5000)
      const check = setInterval(() => {
        if (!this.child || this.child.killed) {
          clearTimeout(timeout)
          clearInterval(check)
          resolve()
        }
      }, 200)
    })
  }

  replyPermission(
    requestId: string,
    behavior: 'allow' | 'deny',
    opts?: { updatedInput?: Record<string, unknown>; message?: string },
  ): void {
    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response:
          behavior === 'allow'
            ? { behavior: 'allow', updatedInput: opts?.updatedInput }
            : { behavior: 'deny', message: opts?.message ?? 'Denied' },
      },
    }
    this.writeStdin(jsonStringify(response))
    this.pendingPermissions.delete(requestId)
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
    this.rejectAllPendingControlResponses(new Error('Session killed'))
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
    this.rejectAllPendingControlResponses(new Error('Session force killed'))
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
      session_id: this.sessionId,
      status: this._status,
      cwd: this.cwd,
      title: this._title,
      model: this._model,
      permission_mode: this._permissionMode,
      created_at: this.createdAt,
      last_active_at: this.lastActiveAt,
      cost_usd: this._costUsd,
      input_tokens: this._inputTokens,
      output_tokens: this._outputTokens,
    }
  }

  private writeStdin(data: string): void {
    if (this.child?.stdin && !this.child.stdin.destroyed) {
      this.child.stdin.write(data + '\n')
    }
  }

  private rejectAllPendingControlResponses(error: Error): void {
    for (const [id, pending] of this.pendingControlResponses) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingControlResponses.clear()
  }
}
