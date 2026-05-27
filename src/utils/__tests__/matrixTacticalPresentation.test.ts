import { describe, expect, test } from 'bun:test';
import { stringWidth } from '@anthropic/ink';
import {
  MATRIX_TACTICAL_BANNER_LINES,
  formatMatrixBox,
  formatMatrixPrefix,
  formatMatrixProgress,
  matrixScenarioPrefix,
} from '../matrixTacticalPresentation.js';

describe('matrixTacticalPresentation', () => {
  test('formatMatrixPrefix pads short labels inside brackets', () => {
    expect(formatMatrixPrefix('OK')).toBe('[OK  ]');
    expect(formatMatrixPrefix('SYS')).toBe('[SYS ]');
    expect(formatMatrixPrefix('ABORT')).toBe('[ABORT]');
  });

  test('formatMatrixPrefix truncates long labels', () => {
    expect(formatMatrixPrefix('TOOLONG')).toBe('[TOOLO]');
  });

  test('matrixScenarioPrefix returns canonical labels', () => {
    expect(matrixScenarioPrefix('startup')).toBe('[SYS ]');
    expect(matrixScenarioPrefix('working')).toBe('[RUN ]');
    expect(matrixScenarioPrefix('waiting_permission')).toBe('[REQ ]');
    expect(matrixScenarioPrefix('completed')).toBe('[OK  ]');
    expect(matrixScenarioPrefix('blocked')).toBe('[ERR ]');
  });

  test('formatMatrixProgress renders ASCII only', () => {
    expect(formatMatrixProgress(70, 30)).toBe('[====================>.........] 70%');
    expect(formatMatrixProgress(0, 10)).toBe('[>.........] 0%');
    expect(formatMatrixProgress(100, 10)).toBe('[==========] 100%');
  });

  test('formatMatrixProgress clamps values', () => {
    expect(formatMatrixProgress(-5, 10)).toBe('[>.........] 0%');
    expect(formatMatrixProgress(150, 10)).toBe('[==========] 100%');
  });

  test('formatMatrixProgress handles non-finite values', () => {
    expect(formatMatrixProgress(NaN, 10)).toBe('[>.........] 0%');
    expect(() => formatMatrixProgress(50, Infinity)).not.toThrow();
    expect(formatMatrixProgress(50, Infinity)).toBe('[==============>...............] 50%');
  });

  test('formatMatrixBox wraps lines with a title', () => {
    expect(formatMatrixBox('阻 塞 诊 断', ['触发原因: 类型错误'])).toEqual([
      '┌─── [ 阻 塞 诊 断 ] ───────────────────────────────────────┐',
      ' │ 触发原因: 类型错误                                      │',
      ' └──────────────────────────────────────────────────────────┘',
    ]);
  });

  test('formatMatrixBox truncates long content to keep the right border aligned', () => {
    const box = formatMatrixBox('TRACE', ['0123456789'.repeat(10)]);
    const contentLine = box[1]!;

    expect(contentLine.endsWith('│')).toBe(true);
    expect(stringWidth(contentLine)).toBeLessThanOrEqual(stringWidth(box[2]!));
  });

  test('formatMatrixBox pads wide content to a stable display width', () => {
    const box = formatMatrixBox('WIDE', ['全角状态：等待权限', 'ASCII']);
    const contentLine = box[1]!;
    const asciiLine = box[2]!;

    expect(contentLine.endsWith('│')).toBe(true);
    expect(asciiLine.endsWith('│')).toBe(true);
    expect(stringWidth(contentLine)).toBe(stringWidth(asciiLine));
  });

  test('formatMatrixBox keeps wide title borders within the box width', () => {
    const box = formatMatrixBox('全角标题', ['OK']);

    expect(box[0]!.endsWith('┐')).toBe(true);
    expect(stringWidth(box[0]!)).toBeLessThanOrEqual(stringWidth(box[2]!));
  });

  test('banner matches source Matrix Tactical COSTRICT logo shape', () => {
    expect(MATRIX_TACTICAL_BANNER_LINES).toHaveLength(6);
    expect(MATRIX_TACTICAL_BANNER_LINES[0]).toContain('██████╗');
    expect(MATRIX_TACTICAL_BANNER_LINES[5]).toContain('╚═════╝');
  });
});
