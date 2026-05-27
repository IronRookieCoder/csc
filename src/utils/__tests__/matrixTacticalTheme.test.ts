import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_GLOBAL_CONFIG,
  MATRIX_TACTICAL_MIGRATION_VERSION,
  filterConfigForSaveForTesting,
  mergeGlobalConfigForMigrationForTesting,
  migrateMatrixTacticalThemeConfigForTesting,
} from '../config.js';
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

describe('matrix tactical config migration', () => {
  test('migrates missing theme to matrix tactical', () => {
    const migrated = migrateMatrixTacticalThemeConfigForTesting({
      numStartups: 0,
      preferredNotifChannel: 'auto',
      verbose: false,
      env: {},
      tipsHistory: {},
      memoryUsageCount: 0,
      promptQueueUseCount: 0,
      btwUseCount: 0,
      todoFeatureEnabled: true,
      showTurnDuration: true,
      messageIdleNotifThresholdMs: 60000,
      fileCheckpointingEnabled: true,
      terminalProgressBarEnabled: true,
      cachedStatsigGates: {},
      respectGitignore: true,
      copyFullResponse: false,
    } as any);

    expect(migrated.theme).toBe('matrix-tactical');
    expect(migrated.matrixTacticalThemeMigrationVersion).toBe(MATRIX_TACTICAL_MIGRATION_VERSION);
  });

  test('migrates old default dark once', () => {
    const migrated = migrateMatrixTacticalThemeConfigForTesting({
      theme: 'dark',
      matrixTacticalThemeMigrationVersion: undefined,
    } as any);

    expect(migrated.theme).toBe('matrix-tactical');
  });

  test('does not override non-default themes', () => {
    for (const theme of ['light', 'auto', 'dark-ansi', 'light-ansi', 'dark-daltonized', 'light-daltonized'] as const) {
      const migrated = migrateMatrixTacticalThemeConfigForTesting({
        theme,
        matrixTacticalThemeMigrationVersion: undefined,
      } as any);
      expect(migrated.theme).toBe(theme);
    }
  });

  test('does not re-migrate dark after migration guard is set', () => {
    const migrated = migrateMatrixTacticalThemeConfigForTesting({
      theme: 'dark',
      matrixTacticalThemeMigrationVersion: MATRIX_TACTICAL_MIGRATION_VERSION,
    } as any);

    expect(migrated.theme).toBe('dark');
  });

  test('migrates raw old default dark after default config merge', () => {
    const migrated = mergeGlobalConfigForMigrationForTesting({
      theme: 'dark',
    } as any);

    expect(migrated.theme).toBe('matrix-tactical');
    expect(migrated.matrixTacticalThemeMigrationVersion).toBe(MATRIX_TACTICAL_MIGRATION_VERSION);
  });

  test('preserves raw dark when migration guard exists', () => {
    const migrated = mergeGlobalConfigForMigrationForTesting({
      theme: 'dark',
      matrixTacticalThemeMigrationVersion: MATRIX_TACTICAL_MIGRATION_VERSION,
    } as any);

    expect(migrated.theme).toBe('dark');
  });

  test('preserves raw non-default theme after default config merge', () => {
    const migrated = mergeGlobalConfigForMigrationForTesting({
      theme: 'light',
    } as any);

    expect(migrated.theme).toBe('light');
    expect(migrated.matrixTacticalThemeMigrationVersion).toBe(MATRIX_TACTICAL_MIGRATION_VERSION);
  });

  test('preserves migration guard when saving dark theme config', () => {
    const filtered = filterConfigForSaveForTesting(
      {
        ...DEFAULT_GLOBAL_CONFIG,
        theme: 'dark',
        matrixTacticalThemeMigrationVersion: MATRIX_TACTICAL_MIGRATION_VERSION,
      },
      DEFAULT_GLOBAL_CONFIG,
    );

    expect(filtered.theme).toBe('dark');
    expect(filtered.matrixTacticalThemeMigrationVersion).toBe(MATRIX_TACTICAL_MIGRATION_VERSION);
  });

  test('preserves migration guard without writing all default fields', () => {
    const filtered = filterConfigForSaveForTesting(
      DEFAULT_GLOBAL_CONFIG,
      DEFAULT_GLOBAL_CONFIG,
    );

    expect(filtered).toEqual({
      matrixTacticalThemeMigrationVersion: MATRIX_TACTICAL_MIGRATION_VERSION,
    });
  });
});
