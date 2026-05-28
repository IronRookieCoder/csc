import { stringWidth } from '@anthropic/ink';
import type { Theme } from './theme.js';
import { truncateToWidthNoEllipsis } from './truncate.js';

export type MatrixScenario =
  | 'startup'
  | 'idle'
  | 'working'
  | 'waiting_permission'
  | 'completed'
  | 'blocked';

export type MatrixTone = 'primary' | 'success' | 'warning' | 'permission' | 'error' | 'meta' | 'input';

export const MATRIX_TACTICAL_THEME_NAME = 'matrix-tactical' as const;
export const MATRIX_TACTICAL_MIGRATION_VERSION = 1;

export const MATRIX_TACTICAL_BANNER_LINES = [
  ' ██████╗ ██████╗ ███████╗████████╗██████╗ ██╗ ██████╗████████╗',
  '██╔════╝██╔═══██╗██╔════╝╚══██╔══╝██╔══██╗██║██╔════╝╚══██╔══╝',
  '██║     ██║   ██║███████╗   ██║   ██████╔╝██║██║        ██║   ',
  '██║     ██║   ██║╚════██║   ██║   ██╔══██╗██║██║        ██║   ',
  '╚██████╗╚██████╔╝███████║   ██║   ██║  ██║██║╚██████╗   ██║   ',
  ' ╚═════╝ ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝ ╚═════╝   ╚═╝   ',
] as const;

export const MATRIX_TACTICAL_TONE_TO_THEME_KEY = {
  primary: 'success',
  success: 'success',
  warning: 'warning',
  permission: 'warning',
  error: 'error',
  meta: 'inactive',
  input: 'text',
} as const satisfies Record<MatrixTone, keyof Theme>;

const SCENARIO_PREFIX = {
  startup: 'SYS',
  idle: 'SYS',
  working: 'RUN',
  waiting_permission: 'REQ',
  completed: 'OK',
  blocked: 'ERR',
} as const satisfies Record<MatrixScenario, string>;

export function isMatrixTacticalTheme(theme: string): boolean {
  return theme === MATRIX_TACTICAL_THEME_NAME;
}

export function formatMatrixPrefix(label: string): string {
  const normalized = label.trim().toUpperCase();
  return `[${normalized.slice(0, 5)}]`;
}

export function matrixScenarioPrefix(scenario: MatrixScenario): string {
  return formatMatrixPrefix(SCENARIO_PREFIX[scenario]);
}

export function formatMatrixProgress(percent: number, width = 30): string {
  const normalizedPercent = Number.isFinite(percent) ? percent : 0;
  const normalizedWidth = Number.isFinite(width) ? width : 30;
  const clamped = Math.max(0, Math.min(100, Math.round(normalizedPercent)));
  const safeWidth = Math.max(2, Math.round(normalizedWidth));
  if (clamped >= 100) {
    return `[${'='.repeat(safeWidth)}] 100%`;
  }
  const filled = Math.max(0, Math.floor((clamped / 100) * safeWidth) - 1);
  const empty = Math.max(0, safeWidth - filled - 1);
  return `[${'='.repeat(filled)}>${'.'.repeat(empty)}] ${clamped}%`;
}

export function formatMatrixBox(title: string, lines: string[], width = 58): string[] {
  const safeWidth = Number.isFinite(width) ? Math.max(14, Math.round(width)) : 58;
  const maxTitleWidth = Math.max(1, safeWidth - stringWidth('┌─── [  ] ┐') - 1);
  const normalizedTitle = `[ ${truncateToWidthNoEllipsis(title, maxTitleWidth)} ]`;
  const topFill = Math.max(1, safeWidth - stringWidth(normalizedTitle) - 4);
  const innerWidth = Math.max(10, safeWidth - 2);
  return [
    `┌─── ${normalizedTitle} ${'─'.repeat(topFill)}┐`,
    ...lines.map(line => {
      const truncated = truncateToWidthNoEllipsis(line, innerWidth);
      return ` │ ${truncated}${' '.repeat(Math.max(0, innerWidth - stringWidth(truncated)))} │`;
    }),
    ` └${'─'.repeat(safeWidth)}┘`,
  ];
}
