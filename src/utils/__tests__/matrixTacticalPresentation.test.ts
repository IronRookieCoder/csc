import { describe, expect, test } from 'bun:test';
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

  test('formatMatrixBox wraps lines with a title', () => {
    expect(formatMatrixBox('阻 塞 诊 断', ['触发原因: 类型错误'])).toEqual([
      '┌─── [ 阻 塞 诊 断 ] ───────────────────────────────────────┐',
      ' │ 触发原因: 类型错误                                      │',
      ' └──────────────────────────────────────────────────────────┘',
    ]);
  });

  test('banner matches source Matrix Tactical COSTRICT logo shape', () => {
    expect(MATRIX_TACTICAL_BANNER_LINES).toHaveLength(6);
    expect(MATRIX_TACTICAL_BANNER_LINES[0]).toContain('██████╗');
    expect(MATRIX_TACTICAL_BANNER_LINES[5]).toContain('╚═════╝');
  });
});
