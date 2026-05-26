import { afterEach, describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToString } from '../../../utils/staticRender.js';
import { resetTerminalCapabilitiesForTests } from '../../../utils/terminalCapabilities.js';
import { WidgetBar } from '../WidgetBar.js';
import type { WidgetBarState } from '../../../utils/widgetBar.js';

const baseState: WidgetBarState = {
  widgets: [
    { key: 'model', label: 'Opus 4.7', tone: 'default' },
    { key: 'context', label: 'ctx 12%', tone: 'default' },
    { key: 'cost', label: '$0.34', tone: 'success' },
    { key: 'cache', label: 'Cache 45% 52:18', tone: 'muted' },
  ],
  shortcuts: 'Esc cancel · ? help · ↓ tasks',
};

const originalTerm = process.env.TERM;
const originalLang = process.env.LANG;
const originalLcAll = process.env.LC_ALL;
const originalTermProgram = process.env.TERM_PROGRAM;
const originalWtSession = process.env.WT_SESSION;

function restoreEnv(): void {
  if (originalTerm === undefined) delete process.env.TERM;
  else process.env.TERM = originalTerm;
  if (originalLang === undefined) delete process.env.LANG;
  else process.env.LANG = originalLang;
  if (originalLcAll === undefined) delete process.env.LC_ALL;
  else process.env.LC_ALL = originalLcAll;
  if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM;
  else process.env.TERM_PROGRAM = originalTermProgram;
  if (originalWtSession === undefined) delete process.env.WT_SESSION;
  else process.env.WT_SESSION = originalWtSession;
  resetTerminalCapabilitiesForTests();
}

function useUnicodeTerminal(): void {
  process.env.TERM = 'xterm-256color';
  process.env.LANG = 'en_US.UTF-8';
  delete process.env.LC_ALL;
  process.env.TERM_PROGRAM = 'WezTerm';
  delete process.env.WT_SESSION;
  resetTerminalCapabilitiesForTests();
}

function useAsciiTerminal(): void {
  process.env.TERM = 'dumb';
  process.env.LANG = 'C';
  delete process.env.LC_ALL;
  delete process.env.TERM_PROGRAM;
  delete process.env.WT_SESSION;
  resetTerminalCapabilitiesForTests();
}

afterEach(() => {
  restoreEnv();
});

describe('WidgetBar', () => {
  test('renders powerline separators in unicode terminals', async () => {
    useUnicodeTerminal();

    const out = await renderToString(<WidgetBar state={baseState} columns={140} />, 140);

    expect(out).toContain('Opus 4.7');
    expect(out).toContain('');
    expect(out).not.toContain('|');
    expect(out).not.toContain('[Opus 4.7]');
    expect(out).toContain('Esc cancel · ? help · ↓ tasks');
  });

  test('falls back to ascii separators when unicode is unavailable', async () => {
    useAsciiTerminal();

    const out = await renderToString(<WidgetBar state={baseState} columns={140} />, 140);

    expect(out).toContain('Opus 4.7');
    expect(out).toContain(' | ');
    expect(out).not.toContain('');
    expect(out).toContain('Esc cancel · ? help · ↓ tasks');
  });

  test('keeps key status visible at short widths', async () => {
    useUnicodeTerminal();

    const out = await renderToString(
      <WidgetBar
        state={{
          ...baseState,
          shortcuts: '? Help',
        }}
        columns={40}
      />,
      40,
    );

    expect(out).toContain('Opus 4.7');
    expect(out).toContain('? Help');
  });
});
