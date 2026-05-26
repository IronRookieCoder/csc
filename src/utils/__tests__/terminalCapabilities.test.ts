import { afterEach, describe, expect, test } from 'bun:test'
import {
  getTerminalCapabilities,
  getTerminalGlyphs,
  getTerminalLayout,
  resetTerminalCapabilitiesForTests,
  type TerminalCapabilityEnv,
} from '../terminalCapabilities'

function caps(env: TerminalCapabilityEnv, columns?: number) {
  resetTerminalCapabilitiesForTests()
  return getTerminalCapabilities(env, columns)
}

afterEach(() => {
  resetTerminalCapabilitiesForTests()
})

describe('terminalCapabilities', () => {
  test('detects unicode and true color terminals', () => {
    const result = caps(
      {
        TERM: 'xterm-256color',
        LANG: 'zh_CN.UTF-8',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'WezTerm',
      },
      140,
    )

    expect(result.charset).toBe('unicode')
    expect(result.colorDepth).toBe('truecolor')
    expect(result.columns).toBe(140)
    expect(result.terminalFamily).toBe('wezterm')
  })

  test('treats known modern terminals as unicode even without locale variables', () => {
    const result = caps({ WT_SESSION: '1', TERM: 'xterm-256color' }, 120)

    expect(result.charset).toBe('unicode')
    expect(result.terminalFamily).toBe('windows-terminal')
  })

  test('falls back to ascii when locale is not utf8 or terminal is dumb', () => {
    expect(caps({ TERM: 'dumb', LANG: 'C' }, 90).charset).toBe('ascii')
    expect(getTerminalGlyphs(caps({ TERM: 'dumb', LANG: 'C' }, 90))).toEqual({
      done: '[OK]',
      running: '[..]',
      pending: '[  ]',
      attention: '[!!]',
      confirm: '[?]',
      connector: '-',
      statusSeparator: '|',
      statusEdge: '',
      statusAsciiSeparator: ' | ',
    })
  })

  test('uses 80 columns when width is missing or invalid', () => {
    expect(
      caps({ TERM: 'xterm-256color', LANG: 'en_US.UTF-8' }, undefined).columns,
    ).toBe(80)
    expect(
      caps({ TERM: 'xterm-256color', LANG: 'en_US.UTF-8' }, 0).columns,
    ).toBe(80)
  })

  test('maps terminal width into four responsive layouts', () => {
    expect(getTerminalLayout(140).kind).toBe('full')
    expect(getTerminalLayout(139).kind).toBe('compact')
    expect(getTerminalLayout(150).kind).toBe('full')
    expect(getTerminalLayout(120).kind).toBe('compact')
    expect(getTerminalLayout(119).kind).toBe('single')
    expect(getTerminalLayout(130).kind).toBe('compact')
    expect(getTerminalLayout(80).kind).toBe('single')
    expect(getTerminalLayout(79).kind).toBe('minimal')
    expect(getTerminalLayout(100).kind).toBe('single')
    expect(getTerminalLayout(70).kind).toBe('minimal')
  })

  test('caches environment-derived capabilities without freezing columns', () => {
    const originalTerm = process.env.TERM
    const originalLang = process.env.LANG
    const originalColorTerm = process.env.COLORTERM
    const originalTermProgram = process.env.TERM_PROGRAM
    const originalWtSession = process.env.WT_SESSION

    try {
      process.env.TERM = 'xterm-256color'
      process.env.LANG = 'en_US.UTF-8'
      process.env.COLORTERM = 'truecolor'
      delete process.env.TERM_PROGRAM
      delete process.env.WT_SESSION
      resetTerminalCapabilitiesForTests()

      const first = getTerminalCapabilities(process.env, 100)
      process.env.TERM = 'dumb'
      process.env.LANG = 'C'
      const second = getTerminalCapabilities(process.env, 140)

      expect(first.charset).toBe('unicode')
      expect(second.charset).toBe('unicode')
      expect(second.columns).toBe(140)

      resetTerminalCapabilitiesForTests()
      const afterReset = getTerminalCapabilities(process.env, 90)

      expect(afterReset.charset).toBe('ascii')
      expect(afterReset.columns).toBe(90)
    } finally {
      if (originalTerm === undefined) delete process.env.TERM
      else process.env.TERM = originalTerm
      if (originalLang === undefined) delete process.env.LANG
      else process.env.LANG = originalLang
      if (originalColorTerm === undefined) delete process.env.COLORTERM
      else process.env.COLORTERM = originalColorTerm
      if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM
      else process.env.TERM_PROGRAM = originalTermProgram
      if (originalWtSession === undefined) delete process.env.WT_SESSION
      else process.env.WT_SESSION = originalWtSession
      resetTerminalCapabilitiesForTests()
    }
  })

  test('does not cache custom environment objects', () => {
    const env: TerminalCapabilityEnv = {
      TERM: 'xterm-256color',
      LANG: 'en_US.UTF-8',
      COLORTERM: 'truecolor',
    }

    expect(getTerminalCapabilities(env, 100).colorDepth).toBe('truecolor')
    env.COLORTERM = undefined
    expect(getTerminalCapabilities(env, 120).colorDepth).toBe('indexed')
  })
})
