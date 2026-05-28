import { describe, expect, test } from 'bun:test';
import { getTheme } from '../../../utils/theme.js';
import { getStalledSpinnerColor } from '../stalledColor.js';

describe('getStalledSpinnerColor', () => {
  test('keeps Matrix tactical spinner text in the active work color', () => {
    const theme = getTheme('matrix-tactical');

    const color = getStalledSpinnerColor({
      themeName: 'matrix-tactical',
      theme,
      messageColor: 'claude',
      stalledIntensity: 1,
    });

    expect(color).toBe('rgb(52,211,153)');
    expect(color).not.toBe(theme.error);
    expect(color).not.toBe('error');
  });

  test('keeps non-rgb Matrix tactical fallbacks on the message color key', () => {
    const theme = { ...getTheme('matrix-tactical'), claude: 'ansi:green' };

    const color = getStalledSpinnerColor({
      themeName: 'matrix-tactical',
      theme,
      messageColor: 'claude',
      stalledIntensity: 1,
    });

    expect(color).toBe('claude');
    expect(color).not.toBe('error');
  });
});
