export const WIDGET_KEYS = [
  'model',
  'context',
  'cache',
  'cost',
  'branch',
] as const

export type WidgetKey = (typeof WIDGET_KEYS)[number]

export type WidgetTone = 'default' | 'success' | 'warning' | 'error' | 'muted'

export type WidgetItem = {
  key: WidgetKey
  label: string
  tone: WidgetTone
}

export type WidgetBarState = {
  widgets: WidgetItem[]
  shortcuts: string
}

export type WidgetBarInput = {
  columns: number
  modelName: string
  contextUsedPct: number
  totalCostUsd: number
  cacheHitRate: number | null
  cacheCountdown: string
  branch?: string
  linesAdded: number
  linesRemoved: number
}

function roundPct(value: number): number {
  return Math.round(value)
}

function toneForPercent(value: number): WidgetTone {
  if (value > 95) return 'error'
  if (value > 80) return 'warning'
  return 'default'
}

function formatCost(cost: number, maxDecimalPlaces: number): string {
  return `$${cost > 0.5 ? (Math.round(cost * 100) / 100).toFixed(2) : cost.toFixed(maxDecimalPlaces)}`
}

function titleToken(token: string): string {
  return token.length === 0
    ? token
    : `${token[0]?.toUpperCase()}${token.slice(1)}`
}

function isDateToken(token: string): boolean {
  return /^\d{8}$/.test(token)
}

function isVersionToken(token: string): boolean {
  return /^\d+[a-z]?$/.test(token)
}

function isReleaseSuffix(token: string): boolean {
  return /^v\d+$/i.test(token)
}

function formatVersion(tokens: string[]): string {
  if (tokens.every(token => /^\d+$/.test(token))) return tokens.join('.')
  return tokens.join('-')
}

function nextNameToken(
  tokens: string[],
  startIndex: number,
): string | undefined {
  for (let index = startIndex; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === undefined || isReleaseSuffix(token) || isDateToken(token))
      continue
    if (/^[a-z]+$/i.test(token)) return token
    return undefined
  }
  return undefined
}

export function compactModelName(modelName: string): string {
  const trimmed = modelName.trim()
  if (trimmed.length === 0 || /\s/.test(trimmed)) return modelName

  const contextSuffixes: string[] = []
  const withoutContextSuffix = trimmed.replace(
    /\[(\d+)m\]/gi,
    (_match, size: string) => {
      contextSuffixes.push(`${size}M`)
      return ''
    },
  )
  const tokens = withoutContextSuffix
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(token => token.length > 0 && !isDateToken(token))

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === undefined || !isVersionToken(token)) continue

    const versionTokens = [token]
    let cursor = index + 1
    while (cursor < tokens.length && isVersionToken(tokens[cursor] ?? '')) {
      versionTokens.push(tokens[cursor]!)
      cursor++
    }

    const nameToken = index > 0 ? tokens[index - 1] : undefined
    if (nameToken === undefined || isReleaseSuffix(nameToken)) continue

    const trailingName = nextNameToken(tokens, cursor)
    const labelParts = [
      titleToken(nameToken),
      formatVersion(versionTokens),
      ...(trailingName === undefined ? [] : [titleToken(trailingName)]),
      ...contextSuffixes,
    ]

    if (labelParts.length > 1) {
      return labelParts.join(' ')
    }
  }

  return modelName
}

function deriveWidget(input: WidgetBarInput, key: WidgetKey): WidgetItem {
  switch (key) {
    case 'model':
      return { key, label: compactModelName(input.modelName), tone: 'default' }
    case 'context': {
      const pct = roundPct(input.contextUsedPct)
      return { key, label: `ctx ${pct}%`, tone: toneForPercent(pct) }
    }
    case 'cost':
      return { key, label: formatCost(input.totalCostUsd, 2), tone: 'default' }
    case 'cache': {
      const hitRate =
        input.cacheHitRate === null
          ? '--'
          : String(roundPct(input.cacheHitRate))
      const hasSuccess = input.cacheHitRate !== null && input.cacheHitRate > 50
      const tone = hasSuccess
        ? 'success'
        : input.cacheCountdown === 'exp'
          ? 'muted'
          : 'default'
      return { key, label: `Cache ${hitRate}% ${input.cacheCountdown}`, tone }
    }
    case 'branch':
      return {
        key,
        label: `${input.branch ?? '-'} ${input.linesAdded}↑${input.linesRemoved}↓`,
        tone: 'default',
      }
  }
}

export function deriveWidgetBarState(input: WidgetBarInput): WidgetBarState {
  return {
    widgets: WIDGET_KEYS.map(key => deriveWidget(input, key)),
    shortcuts: input.columns < 80 ? '? Help' : 'Esc cancel · ? help · ↓ tasks',
  }
}
