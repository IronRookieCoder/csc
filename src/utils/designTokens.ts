import type { Theme } from './theme.js'
import type { TerminalCapabilities } from './terminalCapabilities.js'
import { getTerminalCapabilities } from './terminalCapabilities.js'

export type DesignTokenColor = keyof Theme | `#${string}`

export type DesignTokens = {
  accent: DesignTokenColor
  success: DesignTokenColor
  warning: DesignTokenColor
  error: DesignTokenColor
  muted: DesignTokenColor
  border: DesignTokenColor
  surface: DesignTokenColor
  background: DesignTokenColor
  pipelineDone: DesignTokenColor
  pipelineRunning: DesignTokenColor
  pipelinePending: DesignTokenColor
  pipelineAttention: DesignTokenColor
  pipelineConnector: DesignTokenColor
}

function isLightTheme(theme: string): boolean {
  return theme.startsWith('light')
}

function isColorblindTheme(theme: string): boolean {
  return theme.includes('daltonized')
}

const indexedTokens: Readonly<DesignTokens> = Object.freeze({
  accent: 'claudeBlue_FOR_SYSTEM_SPINNER',
  success: 'success',
  warning: 'warning',
  error: 'error',
  muted: 'inactive',
  border: 'promptBorder',
  surface: 'userMessageBackground',
  background: 'background',
  pipelineDone: 'success',
  pipelineRunning: 'claudeBlue_FOR_SYSTEM_SPINNER',
  pipelinePending: 'inactive',
  pipelineAttention: 'warning',
  pipelineConnector: 'promptBorder',
})

export function getDesignTokens(theme: string, capabilities: TerminalCapabilities = getTerminalCapabilities()): DesignTokens {
  if (capabilities.colorDepth !== 'truecolor') return { ...indexedTokens }

  if (isColorblindTheme(theme) && isLightTheme(theme)) {
    return {
      accent: '#5769f7',
      success: '#2f81f7',
      warning: '#9a6700',
      error: '#cf222e',
      muted: '#6e7781',
      border: '#d8d0c7',
      surface: '#f6efe7',
      background: '#fffaf3',
      pipelineDone: '#2f81f7',
      pipelineRunning: '#5769f7',
      pipelinePending: '#afb8c1',
      pipelineAttention: '#9a6700',
      pipelineConnector: '#d8d0c7',
    }
  }

  if (isColorblindTheme(theme)) {
    return {
      accent: '#5769f7',
      success: '#2f81f7',
      warning: '#d29922',
      error: '#f85149',
      muted: '#8b949e',
      border: '#30363d',
      surface: '#161b22',
      background: '#0d1117',
      pipelineDone: '#2f81f7',
      pipelineRunning: '#58a6ff',
      pipelinePending: '#484f58',
      pipelineAttention: '#d29922',
      pipelineConnector: '#30363d',
    }
  }

  if (isLightTheme(theme)) {
    return {
      accent: '#5769f7',
      success: '#1a7f37',
      warning: '#9a6700',
      error: '#cf222e',
      muted: '#6e7781',
      border: '#d8d0c7',
      surface: '#f6efe7',
      background: '#fffaf3',
      pipelineDone: '#1a7f37',
      pipelineRunning: '#5769f7',
      pipelinePending: '#afb8c1',
      pipelineAttention: '#9a6700',
      pipelineConnector: '#d8d0c7',
    }
  }

  return {
    accent: '#58a6ff',
    success: '#3fb950',
    warning: '#d29922',
    error: '#f85149',
    muted: '#8b949e',
    border: '#30363d',
    surface: '#161b22',
    background: '#0d1117',
    pipelineDone: '#3fb950',
    pipelineRunning: '#58a6ff',
    pipelinePending: '#484f58',
    pipelineAttention: '#d29922',
    pipelineConnector: '#30363d',
  }
}
