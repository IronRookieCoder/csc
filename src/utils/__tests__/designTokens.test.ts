import { describe, expect, test } from 'bun:test'
import { getDesignTokens } from '../designTokens'
import { getTerminalCapabilities, type TerminalCapabilities } from '../terminalCapabilities'

const trueColorCaps: TerminalCapabilities = {
  charset: 'unicode',
  colorDepth: 'truecolor',
  columns: 140,
  terminalFamily: 'generic',
}

const indexedCaps: TerminalCapabilities = {
  charset: 'ascii',
  colorDepth: 'indexed',
  columns: 80,
  terminalFamily: 'generic',
}

describe('designTokens', () => {
  test('returns semantic true color tokens for dark themes', () => {
    const tokens = getDesignTokens('dark', trueColorCaps)

    expect(tokens.accent).toBe('#58a6ff')
    expect(tokens.pipelineDone).toBe('#3fb950')
    expect(tokens.pipelineConnector).toBe('#30363d')
  })

  test('returns warm light tokens for light themes', () => {
    const tokens = getDesignTokens('light', trueColorCaps)

    expect(tokens.background).toBe('#fffaf3')
    expect(tokens.surface).toBe('#f6efe7')
    expect(tokens.accent).toBe('#5769f7')
  })

  test('returns colorblind-specific tokens for daltonized themes', () => {
    const tokens = getDesignTokens('dark-daltonized', trueColorCaps)

    expect(tokens.accent).toBe('#5769f7')
    expect(tokens.success).toBe('#2f81f7')
    expect(tokens.pipelineDone).toBe('#2f81f7')
  })

  test('keeps warm light surfaces for light daltonized themes', () => {
    const tokens = getDesignTokens('light-daltonized', trueColorCaps)

    expect(tokens.background).toBe('#fffaf3')
    expect(tokens.surface).toBe('#f6efe7')
    expect(tokens.success).toBe('#2f81f7')
    expect(tokens.pipelineDone).toBe('#2f81f7')
  })

  test('falls back to named theme keys when true color is unavailable', () => {
    const tokens = getDesignTokens('dark', indexedCaps)

    expect(tokens.accent).toBe('claudeBlue_FOR_SYSTEM_SPINNER')
    expect(tokens.success).toBe('success')
    expect(tokens.error).toBe('error')
  })

  test('returns independent indexed token objects', () => {
    const first = getDesignTokens('dark', indexedCaps)
    first.accent = 'error'
    const second = getDesignTokens('dark', indexedCaps)

    expect(second.accent).toBe('claudeBlue_FOR_SYSTEM_SPINNER')
  })

  test('falls back to named theme keys for detected 256 color terminals', () => {
    const capabilities = getTerminalCapabilities({ TERM: 'xterm-256color', LANG: 'en_US.UTF-8' }, 120)
    const tokens = getDesignTokens('dark', capabilities)

    expect(tokens.accent).toBe('claudeBlue_FOR_SYSTEM_SPINNER')
    expect(tokens.success).toBe('success')
  })
})
