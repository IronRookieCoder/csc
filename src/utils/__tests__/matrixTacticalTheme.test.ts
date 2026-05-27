import { describe, expect, test } from 'bun:test';
import { getTheme, THEME_NAMES, THEME_SETTINGS } from '../theme.js';

describe('matrix tactical theme registration', () => {
  test('theme name is registered for rendering and settings', () => {
    expect(THEME_NAMES).toContain('matrix-tactical');
    expect(THEME_SETTINGS).toContain('matrix-tactical');
  });

  test('theme palette uses Matrix Tactical colors', () => {
    const theme = getTheme('matrix-tactical');
    expect(theme.text).toBe('rgb(255,255,255)');
    expect(theme.success).toBe('rgb(52,211,153)');
    expect(theme.warning).toBe('rgb(245,158,11)');
    expect(theme.error).toBe('rgb(251,113,133)');
    expect(theme.promptBorder).toBe('rgb(52,211,153)');
    expect(theme.userMessageBackground).toBe('rgb(9,13,16)');
  });
});
