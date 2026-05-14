import { describe, expect, test } from 'bun:test'
import { shouldUseNonInteractiveSession } from '../nonInteractiveSession.js'

describe('shouldUseNonInteractiveSession', () => {
  test('uses non-interactive mode for explicit headless flags', () => {
    expect(
      shouldUseNonInteractiveSession({
        args: ['--print'],
        forceInteractive: false,
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe(true)
    expect(
      shouldUseNonInteractiveSession({
        args: ['-p'],
        forceInteractive: true,
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe(true)
    expect(
      shouldUseNonInteractiveSession({
        args: ['--init-only'],
        forceInteractive: false,
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe(true)
    expect(
      shouldUseNonInteractiveSession({
        args: ['--sdk-url=http://localhost:1234'],
        forceInteractive: false,
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe(true)
  })

  test('does not enter print mode for PowerShell shims that preserve stdin TTY', () => {
    expect(
      shouldUseNonInteractiveSession({
        args: [],
        forceInteractive: false,
        stdinIsTTY: true,
        stdoutIsTTY: false,
      }),
    ).toBe(false)
  })

  test('keeps automatic non-interactive mode when both stdio sides are non-TTY', () => {
    expect(
      shouldUseNonInteractiveSession({
        args: [],
        forceInteractive: false,
        stdinIsTTY: false,
        stdoutIsTTY: false,
      }),
    ).toBe(true)
    expect(
      shouldUseNonInteractiveSession({
        args: [],
        forceInteractive: false,
        stdinIsTTY: undefined,
        stdoutIsTTY: undefined,
      }),
    ).toBe(true)
  })

  test('forceInteractive only suppresses automatic non-interactive detection', () => {
    expect(
      shouldUseNonInteractiveSession({
        args: [],
        forceInteractive: true,
        stdinIsTTY: false,
        stdoutIsTTY: false,
      }),
    ).toBe(false)
  })
})
