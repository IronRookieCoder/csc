import { describe, expect, test } from 'bun:test'
import { getChatColumnBackgroundColor } from '../chatColumnBackground'
import type { TerminalCapabilities } from '../terminalCapabilities'

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

describe('chatColumnBackground', () => {
  test('uses the dark surface token for true color dark themes', () => {
    expect(getChatColumnBackgroundColor('dark', trueColorCaps)).toBe('#161b22')
  })

  test('uses the warm light surface token for true color light themes', () => {
    expect(getChatColumnBackgroundColor('light', trueColorCaps)).toBe('#f6efe7')
  })

  test('falls back to the indexed surface theme key without throwing', () => {
    expect(getChatColumnBackgroundColor('dark', indexedCaps)).toBe('userMessageBackground')
  })
})
