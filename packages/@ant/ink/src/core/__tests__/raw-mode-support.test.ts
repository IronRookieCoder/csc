import { describe, expect, test } from 'bun:test';
import {
  isWindowsRawModeUnsafe,
  supportsStdinRawMode,
} from '../raw-mode-support.js';

describe('isWindowsRawModeUnsafe', () => {
  test('does not disable raw mode for ordinary Windows shells', () => {
    expect(
      isWindowsRawModeUnsafe({
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      }, 'win32'),
    ).toBe(false);
    expect(
      isWindowsRawModeUnsafe({
        PSModulePath: 'C:\\Program Files\\PowerShell\\Modules',
      }, 'win32'),
    ).toBe(false);
  });

  test('disables raw mode for MSYS2 and Cygwin terminals', () => {
    expect(isWindowsRawModeUnsafe({ MSYSTEM: 'UCRT64' }, 'win32')).toBe(true);
    expect(isWindowsRawModeUnsafe({ TERM: 'cygwin' }, 'win32')).toBe(true);
    expect(isWindowsRawModeUnsafe({ TERM_PROGRAM: 'mintty' }, 'win32')).toBe(
      true,
    );
    expect(isWindowsRawModeUnsafe({ SHELL: '/usr/bin/bash' }, 'win32')).toBe(
      false,
    );
    expect(
      isWindowsRawModeUnsafe({ SHELL: '/usr/bin/msys2_shell.cmd' }, 'win32'),
    ).toBe(true);
  });

  test('supports an explicit emergency disable switch', () => {
    expect(
      isWindowsRawModeUnsafe({
        CLAUDE_CODE_DISABLE_STDIN_RAW_MODE: '1',
      }, 'win32'),
    ).toBe(true);
  });
});

describe('supportsStdinRawMode', () => {
  test('requires a TTY stream with setRawMode', () => {
    expect(supportsStdinRawMode({ isTTY: false } as NodeJS.ReadStream)).toBe(
      false,
    );
    expect(supportsStdinRawMode({ isTTY: true } as NodeJS.ReadStream)).toBe(
      false,
    );
  });
});
