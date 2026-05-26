export type TerminalCharset = 'unicode' | 'ascii'
export type TerminalColorDepth = 'truecolor' | 'indexed'
export type TerminalFamily =
  | 'apple-terminal'
  | 'wezterm'
  | 'windows-terminal'
  | 'vscode'
  | 'generic'

export type TerminalCapabilities = {
  charset: TerminalCharset
  colorDepth: TerminalColorDepth
  columns: number
  terminalFamily: TerminalFamily
}

export type TerminalCapabilityEnv = Record<string, string | undefined> &
  Partial<
    Record<
      'TERM' | 'LANG' | 'LC_ALL' | 'COLORTERM' | 'TERM_PROGRAM' | 'WT_SESSION',
      string | undefined
    >
  >

export type TerminalGlyphs = {
  done: string
  running: string
  pending: string
  attention: string
  confirm: string
  connector: string
  statusSeparator: string
  statusEdge: string
  statusAsciiSeparator: string
}

export type TerminalLayoutKind = 'full' | 'compact' | 'single' | 'minimal'

export type TerminalLayout = {
  kind: TerminalLayoutKind
  showFullPipeline: boolean
  showRail: boolean
  maxWidgets: number
}

type CachedEnvironmentCapabilities = Omit<TerminalCapabilities, 'columns'>

let cachedEnvironmentCapabilities: CachedEnvironmentCapabilities | null = null

function normalize(value: string | undefined): string {
  return (value ?? '').toLowerCase()
}

function detectTerminalFamily(env: TerminalCapabilityEnv): TerminalFamily {
  const termProgram = normalize(env.TERM_PROGRAM)
  if (termProgram.includes('apple_terminal')) return 'apple-terminal'
  if (termProgram.includes('wezterm')) return 'wezterm'
  if (termProgram.includes('vscode')) return 'vscode'
  if (env.WT_SESSION !== undefined) return 'windows-terminal'
  return 'generic'
}

function isKnownUnicodeTerminal(terminalFamily: TerminalFamily): boolean {
  return (
    terminalFamily === 'apple-terminal' ||
    terminalFamily === 'wezterm' ||
    terminalFamily === 'windows-terminal' ||
    terminalFamily === 'vscode'
  )
}

function detectCharset(
  env: TerminalCapabilityEnv,
  terminalFamily: TerminalFamily,
): TerminalCharset {
  const term = normalize(env.TERM)
  const locale = `${normalize(env.LC_ALL)} ${normalize(env.LANG)}`
  if (term === 'dumb') return 'ascii'
  if (locale.trim() === '' && isKnownUnicodeTerminal(terminalFamily))
    return 'unicode'
  if (!locale.includes('utf-8') && !locale.includes('utf8')) return 'ascii'
  return 'unicode'
}

function detectColorDepth(env: TerminalCapabilityEnv): TerminalColorDepth {
  const colorterm = normalize(env.COLORTERM)
  return colorterm.includes('truecolor') || colorterm.includes('24bit')
    ? 'truecolor'
    : 'indexed'
}

function normalizeColumns(columns: number | undefined): number {
  return typeof columns === 'number' && Number.isFinite(columns) && columns > 0
    ? Math.floor(columns)
    : 80
}

export function resetTerminalCapabilitiesForTests(): void {
  cachedEnvironmentCapabilities = null
}

function detectEnvironmentCapabilities(
  env: TerminalCapabilityEnv,
): CachedEnvironmentCapabilities {
  const terminalFamily = detectTerminalFamily(env)
  return {
    charset: detectCharset(env, terminalFamily),
    colorDepth: detectColorDepth(env),
    terminalFamily,
  }
}

export function getTerminalCapabilities(
  env: TerminalCapabilityEnv = process.env,
  columns: number | undefined = process.stdout.columns,
): TerminalCapabilities {
  const environmentCapabilities =
    env === process.env
      ? (cachedEnvironmentCapabilities ??= detectEnvironmentCapabilities(env))
      : detectEnvironmentCapabilities(env)

  return {
    ...environmentCapabilities,
    columns: normalizeColumns(columns),
  }
}

export function getTerminalGlyphs(
  capabilities: TerminalCapabilities = getTerminalCapabilities(),
): TerminalGlyphs {
  if (capabilities.charset === 'ascii') {
    return {
      done: '[OK]',
      running: '[..]',
      pending: '[  ]',
      attention: '[!!]',
      confirm: '[?]',
      connector: '-',
      statusSeparator: '|',
      statusEdge: '',
      statusAsciiSeparator: ' | ',
    }
  }

  return {
    done: '✓',
    running: '◷',
    pending: '○',
    attention: '!',
    confirm: '?',
    connector: '━',
    statusSeparator: '',
    statusEdge: '',
    statusAsciiSeparator: ' | ',
  }
}

export function getTerminalLayout(columns: number): TerminalLayout {
  if (columns >= 140) {
    return {
      kind: 'full',
      showFullPipeline: true,
      showRail: true,
      maxWidgets: 8,
    }
  }
  if (columns >= 120) {
    return {
      kind: 'compact',
      showFullPipeline: false,
      showRail: true,
      maxWidgets: 6,
    }
  }
  if (columns >= 80) {
    return {
      kind: 'single',
      showFullPipeline: false,
      showRail: false,
      maxWidgets: 4,
    }
  }
  return {
    kind: 'minimal',
    showFullPipeline: false,
    showRail: false,
    maxWidgets: 2,
  }
}
