# Matrix Tactical CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Matrix Tactical as CSC CLI's default terminal theme with six-scene visual coverage while preserving existing CLI behavior.

**Architecture:** Implement Matrix Tactical as a presentation layer plus theme palette. Existing components should only add small theme-based dispatch points, while new `src/components/matrix-tactical/*` components own Matrix-specific rendering. Runtime data, permission decisions, tool execution, status metrics, and message models remain unchanged.

**Tech Stack:** Bun, TypeScript, React/Ink (`@anthropic/ink`), Biome, `bun:test`.

---

## File Structure

Create:

- `src/utils/matrixTacticalPresentation.ts`
  - Pure constants and helpers for prefixes, color keys, ASCII progress bars, ASCII boxes, and startup banner lines.
- `src/utils/__tests__/matrixTacticalPresentation.test.ts`
  - Unit tests for pure formatting helpers.
- `src/components/matrix-tactical/MatrixWelcome.tsx`
  - Matrix Tactical startup banner and initialization-style lines.
- `src/components/matrix-tactical/MatrixPrompt.tsx`
  - Matrix Tactical prompt/cursor text helpers.
- `src/components/matrix-tactical/MatrixMessageLine.tsx`
  - Shared single-line prefix renderer for Matrix status/message rows.
- `src/components/matrix-tactical/MatrixToolUseLine.tsx`
  - Matrix wrapper for tool-use rows and progress display.
- `src/components/matrix-tactical/MatrixPermissionFrame.tsx`
  - Matrix wrapper for permission dialogs.
- `src/components/matrix-tactical/MatrixStatusLine.tsx`
  - Matrix rendering for CSC status data shape.
- `src/components/matrix-tactical/index.ts`
  - Barrel exports.
- `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`
  - Component-level smoke tests using shallow React element assertions.
- `src/utils/__tests__/matrixTacticalTheme.test.ts`
  - Theme and migration tests.

Modify:

- `src/utils/theme.ts`
  - Add `matrix-tactical` theme name and palette.
- `packages/@ant/ink/src/theme/theme-types.ts`
  - Mirror `matrix-tactical` theme name and palette.
- `packages/@ant/ink/src/theme/ThemeProvider.tsx`
  - Change fallback default to `matrix-tactical`.
- `src/utils/config.ts`
  - Change default config theme and add guarded migration.
- `src/components/ThemePicker.tsx`
  - Add Matrix Tactical option.
- `packages/builtin-tools/src/tools/ConfigTool/supportedSettings.ts`
  - Pick up theme options through `THEME_NAMES`; no custom logic unless tests fail.
- `src/components/LogoV2/WelcomeV2.tsx`
  - Dispatch to `MatrixWelcome` when current theme is `matrix-tactical`.
- `src/components/permissions/PermissionDialog.tsx`
  - Dispatch to `MatrixPermissionFrame` when current theme is `matrix-tactical`.
- `src/components/StatusLine.tsx`
  - Dispatch to `MatrixStatusLine` for built-in status row when current theme is `matrix-tactical`.
- `src/components/PromptInput/PromptInputFooterLeftSide.tsx`
  - Add Matrix-styled mode/footer prompt rendering with minimal branch.
- `src/components/messages/AssistantToolUseMessage.tsx`
  - Dispatch tool-use display row to `MatrixToolUseLine` when current theme is `matrix-tactical`.

Do not modify:

- Tool execution logic.
- Permission decision logic.
- Message data types.
- Cost/context/rate-limit/cache calculations.

---

### Task 1: Add Pure Matrix Tactical Presentation Helpers

**Files:**
- Create: `src/utils/matrixTacticalPresentation.ts`
- Create: `src/utils/__tests__/matrixTacticalPresentation.test.ts`

- [ ] **Step 1: Write failing tests for prefixes, progress bars, boxes, and banner**

Create `src/utils/__tests__/matrixTacticalPresentation.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test src/utils/__tests__/matrixTacticalPresentation.test.ts
```

Expected: FAIL because `src/utils/matrixTacticalPresentation.ts` does not exist.

- [ ] **Step 3: Implement presentation helpers**

Create `src/utils/matrixTacticalPresentation.ts`:

```ts
import type { Theme } from './theme.js';

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
  return `[${normalized.padEnd(4).slice(0, 5)}]`;
}

export function matrixScenarioPrefix(scenario: MatrixScenario): string {
  return formatMatrixPrefix(SCENARIO_PREFIX[scenario]);
}

export function formatMatrixProgress(percent: number, width = 30): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const safeWidth = Math.max(2, width);
  if (clamped >= 100) {
    return `[${'='.repeat(safeWidth)}] 100%`;
  }
  const filled = Math.max(0, Math.floor((clamped / 100) * safeWidth) - 1);
  const empty = Math.max(0, safeWidth - filled - 1);
  return `[${'='.repeat(filled)}>${'.'.repeat(empty)}] ${clamped}%`;
}

export function formatMatrixBox(title: string, lines: string[], width = 58): string[] {
  const normalizedTitle = `[ ${title} ]`;
  const topFill = Math.max(1, width - normalizedTitle.length - 5);
  const innerWidth = Math.max(10, width - 4);
  return [
    `┌─── ${normalizedTitle} ${'─'.repeat(topFill)}┐`,
    ...lines.map(line => ` │ ${line.padEnd(innerWidth)} │`),
    ` └${'─'.repeat(width)}┘`,
  ];
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
bun test src/utils/__tests__/matrixTacticalPresentation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/matrixTacticalPresentation.ts src/utils/__tests__/matrixTacticalPresentation.test.ts
git commit -m "feat(matrix-tactical): add presentation helpers"
```

---

### Task 2: Add Matrix Tactical Theme Palette and Theme Options

**Files:**
- Modify: `src/utils/theme.ts`
- Modify: `packages/@ant/ink/src/theme/theme-types.ts`
- Modify: `packages/@ant/ink/src/theme/ThemeProvider.tsx`
- Modify: `src/components/ThemePicker.tsx`
- Create: `src/utils/__tests__/matrixTacticalTheme.test.ts`

- [ ] **Step 1: Write failing theme tests**

Create `src/utils/__tests__/matrixTacticalTheme.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test src/utils/__tests__/matrixTacticalTheme.test.ts
```

Expected: FAIL because `matrix-tactical` is not registered.

- [ ] **Step 3: Add palette to `src/utils/theme.ts`**

In `src/utils/theme.ts`, add `'matrix-tactical'` to `THEME_NAMES` before `'dark'`.

Add this theme object near `darkTheme`:

```ts
const matrixTacticalTheme: Theme = {
  ...darkTheme,
  autoAccept: 'rgb(245,158,11)',
  bashBorder: 'rgb(245,158,11)',
  claude: 'rgb(52,211,153)',
  claudeShimmer: 'rgb(110,231,183)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(52,211,153)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(110,231,183)',
  permission: 'rgb(252,211,77)',
  permissionShimmer: 'rgb(253,230,138)',
  planMode: 'rgb(45,212,191)',
  ide: 'rgb(45,212,191)',
  promptBorder: 'rgb(52,211,153)',
  promptBorderShimmer: 'rgb(110,231,183)',
  text: 'rgb(255,255,255)',
  inverseText: 'rgb(9,13,16)',
  inactive: 'rgb(161,161,170)',
  inactiveShimmer: 'rgb(212,212,216)',
  subtle: 'rgb(113,113,122)',
  suggestion: 'rgb(52,211,153)',
  remember: 'rgb(45,212,191)',
  background: 'rgb(9,13,16)',
  success: 'rgb(52,211,153)',
  error: 'rgb(251,113,133)',
  warning: 'rgb(245,158,11)',
  warningShimmer: 'rgb(252,211,77)',
  diffAdded: 'rgb(20,83,45)',
  diffRemoved: 'rgb(127,29,29)',
  diffAddedDimmed: 'rgb(21,45,34)',
  diffRemovedDimmed: 'rgb(57,29,35)',
  diffAddedWord: 'rgb(52,211,153)',
  diffRemovedWord: 'rgb(251,113,133)',
  userMessageBackground: 'rgb(9,13,16)',
  userMessageBackgroundHover: 'rgb(11,15,23)',
  messageActionsBackground: 'rgb(15,23,42)',
  selectionBg: 'rgb(6,78,59)',
  bashMessageBackgroundColor: 'rgb(2,6,23)',
  memoryBackgroundColor: 'rgb(15,23,42)',
  rate_limit_fill: 'rgb(52,211,153)',
  rate_limit_empty: 'rgb(30,41,59)',
  fastMode: 'rgb(245,158,11)',
  fastModeShimmer: 'rgb(252,211,77)',
  briefLabelYou: 'rgb(52,211,153)',
  briefLabelClaude: 'rgb(110,231,183)',
};
```

Update `getTheme()`:

```ts
case 'matrix-tactical':
  return matrixTacticalTheme
```

- [ ] **Step 4: Mirror palette in `packages/@ant/ink/src/theme/theme-types.ts`**

Apply the same `THEME_NAMES`, `matrixTacticalTheme`, and `getTheme()` changes in `packages/@ant/ink/src/theme/theme-types.ts`.

- [ ] **Step 5: Change Ink fallback default**

In `packages/@ant/ink/src/theme/ThemeProvider.tsx`, change:

```ts
let _loadTheme: () => ThemeSetting = () => 'dark';
const DEFAULT_THEME: ThemeName = 'dark';
```

to:

```ts
let _loadTheme: () => ThemeSetting = () => 'matrix-tactical';
const DEFAULT_THEME: ThemeName = 'matrix-tactical';
```

- [ ] **Step 6: Add `/theme` picker option**

In `src/components/ThemePicker.tsx`, add Matrix Tactical after auto and before dark:

```ts
{ label: 'Matrix Tactical (default)', value: 'matrix-tactical' },
```

- [ ] **Step 7: Run theme tests**

Run:

```bash
bun test src/utils/__tests__/matrixTacticalTheme.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/utils/theme.ts packages/@ant/ink/src/theme/theme-types.ts packages/@ant/ink/src/theme/ThemeProvider.tsx src/components/ThemePicker.tsx src/utils/__tests__/matrixTacticalTheme.test.ts
git commit -m "feat(matrix-tactical): register CLI theme"
```

---

### Task 3: Add Guarded Matrix Tactical Config Migration

**Files:**
- Modify: `src/utils/config.ts`
- Modify: `src/utils/__tests__/matrixTacticalTheme.test.ts`

- [ ] **Step 1: Extend migration tests**

Append to `src/utils/__tests__/matrixTacticalTheme.test.ts`:

```ts
import {
  MATRIX_TACTICAL_MIGRATION_VERSION,
  migrateMatrixTacticalThemeConfigForTesting,
} from '../config.js';

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
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test src/utils/__tests__/matrixTacticalTheme.test.ts
```

Expected: FAIL because config migration exports do not exist.

- [ ] **Step 3: Add config fields and migration**

In `src/utils/config.ts`, import:

```ts
import {
  MATRIX_TACTICAL_MIGRATION_VERSION,
  MATRIX_TACTICAL_THEME_NAME,
} from './matrixTacticalPresentation.js'
```

Add to `GlobalConfig`:

```ts
matrixTacticalThemeMigrationVersion?: number
```

Change default in `createDefaultGlobalConfig()`:

```ts
theme: MATRIX_TACTICAL_THEME_NAME,
matrixTacticalThemeMigrationVersion: MATRIX_TACTICAL_MIGRATION_VERSION,
```

Add key to `GLOBAL_CONFIG_KEYS`:

```ts
'matrixTacticalThemeMigrationVersion',
```

Add migration helper before `migrateConfigFields()`:

```ts
function migrateMatrixTacticalThemeConfig(config: GlobalConfig): GlobalConfig {
  if (config.matrixTacticalThemeMigrationVersion === MATRIX_TACTICAL_MIGRATION_VERSION) {
    return config
  }

  const themeWasMissing = !('theme' in config) || config.theme === undefined
  const themeWasOldDefault = config.theme === 'dark'
  if (!themeWasMissing && !themeWasOldDefault) {
    return {
      ...config,
      matrixTacticalThemeMigrationVersion: MATRIX_TACTICAL_MIGRATION_VERSION,
    }
  }

  return {
    ...config,
    theme: MATRIX_TACTICAL_THEME_NAME,
    matrixTacticalThemeMigrationVersion: MATRIX_TACTICAL_MIGRATION_VERSION,
  }
}
```

Update `migrateConfigFields(config)` to run the Matrix migration first:

```ts
config = migrateMatrixTacticalThemeConfig(config)
```

Export for tests near existing testing exports:

```ts
export const migrateMatrixTacticalThemeConfigForTesting = migrateMatrixTacticalThemeConfig
export { MATRIX_TACTICAL_MIGRATION_VERSION }
```

- [ ] **Step 4: Run migration tests**

Run:

```bash
bun test src/utils/__tests__/matrixTacticalTheme.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run focused config-adjacent tests**

Run:

```bash
bun test src/utils/__tests__/matrixTacticalTheme.test.ts src/utils/__tests__/configConstants.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/config.ts src/utils/__tests__/matrixTacticalTheme.test.ts
git commit -m "feat(matrix-tactical): migrate default theme config"
```

---

### Task 4: Add Matrix Welcome Component and Theme Dispatch

**Files:**
- Create: `src/components/matrix-tactical/MatrixWelcome.tsx`
- Create: `src/components/matrix-tactical/index.ts`
- Create: `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`
- Modify: `src/components/LogoV2/WelcomeV2.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`:

```tsx
import React from 'react';
import { describe, expect, test } from 'bun:test';
import { MatrixWelcome } from '../MatrixWelcome.js';
import { MatrixMessageLine } from '../MatrixMessageLine.js';

function collectText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (React.isValidElement(node)) return collectText(node.props.children);
  return '';
}

describe('MatrixWelcome', () => {
  test('renders COSTRICT banner and startup lines', () => {
    const text = collectText(<MatrixWelcome version="2.1.888" />);
    expect(text).toContain('██████╗ ██████╗');
    expect(text).toContain('[SYS]');
    expect(text).toContain('[OK]');
    expect(text).toContain('2.1.888');
  });
});

describe('MatrixMessageLine', () => {
  test('renders prefix and content', () => {
    const text = collectText(<MatrixMessageLine label="RUN" tone="warning">分析指令意图</MatrixMessageLine>);
    expect(text).toContain('[RUN ]');
    expect(text).toContain('分析指令意图');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

Expected: FAIL because Matrix components do not exist.

- [ ] **Step 3: Implement `MatrixMessageLine`**

Create `src/components/matrix-tactical/MatrixMessageLine.tsx`:

```tsx
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import {
  formatMatrixPrefix,
  MATRIX_TACTICAL_TONE_TO_THEME_KEY,
  type MatrixTone,
} from '../../utils/matrixTacticalPresentation.js';

type Props = {
  label: string;
  tone?: MatrixTone;
  children: React.ReactNode;
};

export function MatrixMessageLine({ label, tone = 'meta', children }: Props): React.ReactNode {
  return (
    <Box>
      <Text color={MATRIX_TACTICAL_TONE_TO_THEME_KEY[tone]}>{formatMatrixPrefix(label)} </Text>
      <Text color={tone === 'input' ? 'text' : MATRIX_TACTICAL_TONE_TO_THEME_KEY[tone]}>{children}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Implement `MatrixWelcome`**

Create `src/components/matrix-tactical/MatrixWelcome.tsx`:

```tsx
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { MATRIX_TACTICAL_BANNER_LINES } from '../../utils/matrixTacticalPresentation.js';
import { MatrixMessageLine } from './MatrixMessageLine.js';

type Props = {
  version?: string;
};

export function MatrixWelcome({ version = MACRO.VERSION }: Props): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {MATRIX_TACTICAL_BANNER_LINES.map(line => (
          <Text key={line} color="success">
            {line}
          </Text>
        ))}
      </Box>
      <Text> </Text>
      <MatrixMessageLine label="SYS" tone="meta">
        costrict Console CLI version {version}
      </MatrixMessageLine>
      <MatrixMessageLine label="SYS" tone="meta">
        Matrix Tactical terminal theme active
      </MatrixMessageLine>
      <MatrixMessageLine label="OK" tone="success">
        Local context and configuration ready
      </MatrixMessageLine>
      <Text color="inactive">────────────────────────────────────────────────────────────</Text>
      <MatrixMessageLine label="LOG" tone="meta">
        Type "help" or "?" to view available tactical options.
      </MatrixMessageLine>
    </Box>
  );
}
```

- [ ] **Step 5: Add barrel export**

Create `src/components/matrix-tactical/index.ts`:

```ts
export { MatrixMessageLine } from './MatrixMessageLine.js';
export { MatrixWelcome } from './MatrixWelcome.js';
```

- [ ] **Step 6: Dispatch from `WelcomeV2`**

In `src/components/LogoV2/WelcomeV2.tsx`, import:

```ts
import { isMatrixTacticalTheme } from '../../utils/matrixTacticalPresentation.js';
import { MatrixWelcome } from '../matrix-tactical/MatrixWelcome.js';
```

At the top of `WelcomeV2()` after `const [theme] = useTheme();`, add:

```tsx
if (isMatrixTacticalTheme(theme)) {
  return <MatrixWelcome />;
}
```

- [ ] **Step 7: Run component tests**

Run:

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/matrix-tactical src/components/LogoV2/WelcomeV2.tsx
git commit -m "feat(matrix-tactical): add welcome presentation"
```

---

### Task 5: Add Matrix Permission Frame and Dispatch

**Files:**
- Create: `src/components/matrix-tactical/MatrixPermissionFrame.tsx`
- Modify: `src/components/matrix-tactical/index.ts`
- Modify: `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`
- Modify: `src/components/permissions/PermissionDialog.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`:

```tsx
import { MatrixPermissionFrame } from '../MatrixPermissionFrame.js';

describe('MatrixPermissionFrame', () => {
  test('renders approval frame with REQ and CUE markers', () => {
    const text = collectText(
      <MatrixPermissionFrame title="Bash permission">
        <span>npm install -D vitest</span>
      </MatrixPermissionFrame>,
    );
    expect(text).toContain('[REQ ]');
    expect(text).toContain('Bash permission');
    expect(text).toContain('[CUE ]');
    expect(text).toContain('npm install -D vitest');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

Expected: FAIL because `MatrixPermissionFrame` does not exist.

- [ ] **Step 3: Implement Matrix permission frame**

Create `src/components/matrix-tactical/MatrixPermissionFrame.tsx`:

```tsx
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import type { Theme } from '../../utils/theme.js';
import type { WorkerBadgeProps } from '../permissions/WorkerBadge.js';
import { PermissionRequestTitle } from '../permissions/PermissionRequestTitle.js';
import { MatrixMessageLine } from './MatrixMessageLine.js';

type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  titleColor?: keyof Theme;
  innerPaddingX?: number;
  workerBadge?: WorkerBadgeProps;
  titleRight?: React.ReactNode;
  children: React.ReactNode;
};

export function MatrixPermissionFrame({
  title,
  subtitle,
  titleColor,
  innerPaddingX = 1,
  workerBadge,
  titleRight,
  children,
}: Props): React.ReactNode {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="warning">==================== [ 警 告 : 权 限 提 审 ] ====================</Text>
      <Box paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <PermissionRequestTitle title={title} subtitle={subtitle} color={titleColor ?? 'warning'} workerBadge={workerBadge} />
          {titleRight}
        </Box>
      </Box>
      <Box flexDirection="column" paddingX={innerPaddingX}>
        <MatrixMessageLine label="REQ" tone="permission">
          Review the requested local action before continuing.
        </MatrixMessageLine>
        {children}
        <MatrixMessageLine label="CUE" tone="meta">
          Choose an approval option to continue.
        </MatrixMessageLine>
      </Box>
      <Text color="inactive">================────────────────────────────────────────────────</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Export it**

Update `src/components/matrix-tactical/index.ts`:

```ts
export { MatrixMessageLine } from './MatrixMessageLine.js';
export { MatrixPermissionFrame } from './MatrixPermissionFrame.js';
export { MatrixWelcome } from './MatrixWelcome.js';
```

- [ ] **Step 5: Dispatch from PermissionDialog**

In `src/components/permissions/PermissionDialog.tsx`, import:

```ts
import { useTheme } from '@anthropic/ink';
import { isMatrixTacticalTheme } from '../../utils/matrixTacticalPresentation.js';
import { MatrixPermissionFrame } from '../matrix-tactical/MatrixPermissionFrame.js';
```

Keep existing `Box` import from `@anthropic/ink` by merging imports:

```ts
import { Box, useTheme } from '@anthropic/ink';
```

At the top of `PermissionDialog(...)`, add:

```tsx
const [theme] = useTheme();
if (isMatrixTacticalTheme(theme)) {
  return (
    <MatrixPermissionFrame
      title={title}
      subtitle={subtitle}
      color={color}
      titleColor={titleColor}
      innerPaddingX={innerPaddingX}
      workerBadge={workerBadge}
      titleRight={titleRight}
    >
      {children}
    </MatrixPermissionFrame>
  );
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/matrix-tactical src/components/permissions/PermissionDialog.tsx
git commit -m "feat(matrix-tactical): add permission frame"
```

---

### Task 6: Add Matrix Tool Line and ASCII Progress Dispatch

**Files:**
- Create: `src/components/matrix-tactical/MatrixToolUseLine.tsx`
- Modify: `src/components/matrix-tactical/index.ts`
- Modify: `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`
- Modify: `src/components/messages/AssistantToolUseMessage.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`:

```tsx
import { MatrixToolUseLine } from '../MatrixToolUseLine.js';

describe('MatrixToolUseLine', () => {
  test('renders working tool line with ASCII progress', () => {
    const text = collectText(
      <MatrixToolUseLine
        name="Bash"
        detail="bunx tsc --noEmit"
        state="working"
        progressPercent={70}
      />,
    );
    expect(text).toContain('[RUN ]');
    expect(text).toContain('Bash');
    expect(text).toContain('bunx tsc --noEmit');
    expect(text).toContain('[====================>.........] 70%');
  });

  test('renders errored tool line', () => {
    const text = collectText(<MatrixToolUseLine name="Bash" detail="exit 1" state="error" />);
    expect(text).toContain('[ERR ]');
    expect(text).toContain('exit 1');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

Expected: FAIL because `MatrixToolUseLine` does not exist.

- [ ] **Step 3: Implement Matrix tool line**

Create `src/components/matrix-tactical/MatrixToolUseLine.tsx`:

```tsx
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { formatMatrixProgress } from '../../utils/matrixTacticalPresentation.js';
import { MatrixMessageLine } from './MatrixMessageLine.js';

type MatrixToolState = 'queued' | 'working' | 'success' | 'error';

type Props = {
  name: string;
  detail?: React.ReactNode;
  state: MatrixToolState;
  progressPercent?: number;
};

function labelForState(state: MatrixToolState): string {
  switch (state) {
    case 'queued':
      return 'RUN';
    case 'working':
      return 'RUN';
    case 'success':
      return 'OK';
    case 'error':
      return 'ERR';
  }
}

function toneForState(state: MatrixToolState): 'meta' | 'warning' | 'success' | 'error' {
  switch (state) {
    case 'queued':
      return 'meta';
    case 'working':
      return 'warning';
    case 'success':
      return 'success';
    case 'error':
      return 'error';
  }
}

export function MatrixToolUseLine({ name, detail, state, progressPercent }: Props): React.ReactNode {
  return (
    <Box flexDirection="column">
      <MatrixMessageLine label={labelForState(state)} tone={toneForState(state)}>
        {name}
        {detail ? <Text color="text"> ({detail})</Text> : null}
      </MatrixMessageLine>
      {progressPercent !== undefined && (
        <Box paddingLeft={3}>
          <Text color="success">[PROGRESS] {formatMatrixProgress(progressPercent)}</Text>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Export it**

Update `src/components/matrix-tactical/index.ts`:

```ts
export { MatrixMessageLine } from './MatrixMessageLine.js';
export { MatrixPermissionFrame } from './MatrixPermissionFrame.js';
export { MatrixToolUseLine } from './MatrixToolUseLine.js';
export { MatrixWelcome } from './MatrixWelcome.js';
```

- [ ] **Step 5: Dispatch in AssistantToolUseMessage**

In `src/components/messages/AssistantToolUseMessage.tsx`, import:

```ts
import { isMatrixTacticalTheme } from '../../utils/matrixTacticalPresentation.js';
import { MatrixToolUseLine } from '../matrix-tactical/MatrixToolUseLine.js';
```

After `const renderedToolUseMessage = ...` and before the existing `return`, add:

```tsx
if (isMatrixTacticalTheme(theme)) {
  const state = lookups.erroredToolUseIDs.has(param.id)
    ? 'error'
    : isResolved
      ? 'success'
      : 'working';
  return (
    <Box marginTop={addMargin ? 1 : 0} width="100%" backgroundColor={bg}>
      <MatrixToolUseLine
        name={userFacingToolName}
        detail={renderedToolUseMessage}
        state={state}
        progressPercent={!isResolved && !isQueued ? 70 : undefined}
      />
      {!isResolved &&
        !isQueued &&
        !defaultCollapsed &&
        renderToolUseProgressMessage(
          tool,
          tools,
          lookups,
          param.id,
          progressMessagesForMessage,
          {
            verbose,
            inProgressToolCallCount,
            isTranscriptMode,
          },
          terminalSize,
        )}
      {!isResolved && isQueued && renderToolUseQueuedMessage(tool)}
    </Box>
  );
}
```

Note: `70` is only a visual indeterminate stand-in for tools that do not expose numeric progress. Do not use it for business metrics.

- [ ] **Step 6: Run tests**

Run:

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/matrix-tactical src/components/messages/AssistantToolUseMessage.tsx
git commit -m "feat(matrix-tactical): add tool use line"
```

---

### Task 7: Add Matrix Status Line Rendering for CSC Status Data

**Files:**
- Create: `src/components/matrix-tactical/MatrixStatusLine.tsx`
- Modify: `src/components/matrix-tactical/index.ts`
- Modify: `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`
- Modify: `src/components/StatusLine.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`:

```tsx
import { MatrixStatusLine } from '../MatrixStatusLine.js';

describe('MatrixStatusLine', () => {
  test('renders CSC status fields with Matrix prefix', () => {
    const text = collectText(
      <MatrixStatusLine
        modelName="Sonnet 4.6"
        contextUsedPct={18}
        usedTokens={36000}
        contextWindowSize={200000}
        totalCostUsd={0.02}
        cacheText="Cache 82% 42:10"
        rateLimits={{
          five_hour: { utilization: 0.03, resets_at: 0 },
          seven_day: { utilization: 0.07, resets_at: 0 },
        }}
      />,
    );
    expect(text).toContain('[STAT]');
    expect(text).toContain('Sonnet 4.6');
    expect(text).toContain('Context 18%');
    expect(text).toContain('Session 3%');
    expect(text).toContain('Weekly 7%');
    expect(text).toContain('$0.02');
    expect(text).toContain('Cache 82% 42:10');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

Expected: FAIL because `MatrixStatusLine` does not exist.

- [ ] **Step 3: Implement Matrix status line**

Create `src/components/matrix-tactical/MatrixStatusLine.tsx`:

```tsx
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { formatCost } from '../../cost-tracker.js';
import { formatTokens } from '../../utils/format.js';

type RateLimitBucket = {
  utilization: number;
  resets_at: number;
};

type Props = {
  modelName: string;
  contextUsedPct: number;
  usedTokens: number;
  contextWindowSize: number;
  totalCostUsd: number;
  cacheText?: string;
  rateLimits: {
    five_hour?: RateLimitBucket;
    seven_day?: RateLimitBucket;
  };
};

export function MatrixStatusLine({
  modelName,
  contextUsedPct,
  usedTokens,
  contextWindowSize,
  totalCostUsd,
  cacheText,
  rateLimits,
}: Props): React.ReactNode {
  const sessionPct = rateLimits.five_hour ? Math.round(rateLimits.five_hour.utilization * 100) : null;
  const weeklyPct = rateLimits.seven_day ? Math.round(rateLimits.seven_day.utilization * 100) : null;
  const tokenDisplay = `${formatTokens(usedTokens)}/${formatTokens(contextWindowSize)}`;

  return (
    <Box gap={1}>
      <Text color="success">[STAT]</Text>
      <Text>{modelName}</Text>
      <Text color="inactive">| Context </Text>
      <Text>{contextUsedPct}%</Text>
      <Text color="inactive"> ({tokenDisplay})</Text>
      {sessionPct !== null && (
        <>
          <Text color="inactive">| Session </Text>
          <Text>{sessionPct}%</Text>
        </>
      )}
      {weeklyPct !== null && (
        <>
          <Text color="inactive">| Weekly </Text>
          <Text>{weeklyPct}%</Text>
        </>
      )}
      {totalCostUsd > 0 && (
        <>
          <Text color="inactive">| </Text>
          <Text>{formatCost(totalCostUsd)}</Text>
        </>
      )}
      {cacheText && (
        <>
          <Text color="inactive">| </Text>
          <Text>{cacheText}</Text>
        </>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Export it**

Update `src/components/matrix-tactical/index.ts`:

```ts
export { MatrixMessageLine } from './MatrixMessageLine.js';
export { MatrixPermissionFrame } from './MatrixPermissionFrame.js';
export { MatrixStatusLine } from './MatrixStatusLine.js';
export { MatrixToolUseLine } from './MatrixToolUseLine.js';
export { MatrixWelcome } from './MatrixWelcome.js';
```

- [ ] **Step 5: Dispatch in StatusLine**

In `src/components/StatusLine.tsx`, import:

```ts
import { useTheme } from '@anthropic/ink';
import { isMatrixTacticalTheme } from '../utils/matrixTacticalPresentation.js';
import { MatrixStatusLine } from './matrix-tactical/MatrixStatusLine.js';
```

Merge with existing `Ansi, Box, Text` import:

```ts
import { Ansi, Box, Text, useTheme } from '@anthropic/ink';
```

In `StatusLineInner`, add:

```ts
const [theme] = useTheme();
```

Replace the `BuiltinStatusLine` render inside `showBuiltin` with:

```tsx
{isMatrixTacticalTheme(theme) ? (
  <MatrixStatusLine
    modelName={renderModelName(builtinRuntimeModel)}
    contextUsedPct={builtinContextPct}
    usedTokens={builtinUsedTokens}
    contextWindowSize={builtinContextWindowSize}
    totalCostUsd={getTotalCost()}
    rateLimits={builtinRateLimits}
    cacheText={undefined}
  />
) : (
  <BuiltinStatusLine
    modelName={renderModelName(builtinRuntimeModel)}
    contextUsedPct={builtinContextPct}
    usedTokens={builtinUsedTokens}
    contextWindowSize={builtinContextWindowSize}
    totalCostUsd={getTotalCost()}
    rateLimits={builtinRateLimits}
  />
)}
<CachePill messages={messagesRef.current} />
```

Keep `CachePill` unchanged for this task. A later refinement may fold cache text into MatrixStatusLine, but do not duplicate cache calculations now.

- [ ] **Step 6: Run component tests**

Run:

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx src/components/__tests__/StatusLine.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/matrix-tactical src/components/StatusLine.tsx
git commit -m "feat(matrix-tactical): add status line presentation"
```

---

### Task 8: Add Matrix Prompt/Footer Styling

**Files:**
- Create: `src/components/matrix-tactical/MatrixPrompt.tsx`
- Modify: `src/components/matrix-tactical/index.ts`
- Modify: `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`
- Modify: `src/components/PromptInput/PromptInputFooterLeftSide.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`:

```tsx
import { MatrixPromptCursor, MatrixFooterHint } from '../MatrixPrompt.js';

describe('MatrixPrompt', () => {
  test('renders prompt cursor', () => {
    const text = collectText(<MatrixPromptCursor />);
    expect(text).toContain('[costrict] >>');
  });

  test('renders footer hint with CUE prefix', () => {
    const text = collectText(<MatrixFooterHint>shift+tab cycle mode</MatrixFooterHint>);
    expect(text).toContain('[CUE ]');
    expect(text).toContain('shift+tab cycle mode');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

Expected: FAIL because `MatrixPrompt` does not exist.

- [ ] **Step 3: Implement Matrix prompt helpers**

Create `src/components/matrix-tactical/MatrixPrompt.tsx`:

```tsx
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { MatrixMessageLine } from './MatrixMessageLine.js';

export function MatrixPromptCursor(): React.ReactNode {
  return (
    <Box>
      <Text color="success">[costrict] &gt;&gt;</Text>
    </Box>
  );
}

type HintProps = {
  children: React.ReactNode;
};

export function MatrixFooterHint({ children }: HintProps): React.ReactNode {
  return (
    <MatrixMessageLine label="CUE" tone="meta">
      {children}
    </MatrixMessageLine>
  );
}
```

- [ ] **Step 4: Export it**

Update `src/components/matrix-tactical/index.ts`:

```ts
export { MatrixMessageLine } from './MatrixMessageLine.js';
export { MatrixPermissionFrame } from './MatrixPermissionFrame.js';
export { MatrixFooterHint, MatrixPromptCursor } from './MatrixPrompt.js';
export { MatrixStatusLine } from './MatrixStatusLine.js';
export { MatrixToolUseLine } from './MatrixToolUseLine.js';
export { MatrixWelcome } from './MatrixWelcome.js';
```

- [ ] **Step 5: Apply minimal footer styling branch**

In `src/components/PromptInput/PromptInputFooterLeftSide.tsx`, import:

```ts
import { useTheme } from '@anthropic/ink';
import { isMatrixTacticalTheme } from '../../utils/matrixTacticalPresentation.js';
import { MatrixFooterHint } from '../matrix-tactical/MatrixPrompt.js';
```

Merge with existing `Box, Text, Link` import:

```ts
import { Box, Text, Link, useTheme } from '@anthropic/ink';
```

In `ModeIndicator`, add:

```ts
const [theme] = useTheme();
const isMatrix = isMatrixTacticalTheme(theme);
```

Change the fallback shortcut hint block:

```tsx
if (parts.length === 0 && !tasksPart && !modePart && showHint) {
  parts.push(
    isMatrix ? (
      <MatrixFooterHint key="shortcuts-hint">? for shortcuts</MatrixFooterHint>
    ) : (
      <Text dimColor key="shortcuts-hint">
        ? for shortcuts
      </Text>
    ),
  );
}
```

Do not rework the full prompt input editor in this task. The visible Matrix prompt cursor is covered by `MatrixWelcome` and future prompt input refinements.

- [ ] **Step 6: Run tests**

Run:

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/matrix-tactical src/components/PromptInput/PromptInputFooterLeftSide.tsx
git commit -m "feat(matrix-tactical): add prompt footer styling"
```

---

### Task 9: Final Integration Verification

**Files:**
- Review only unless tests reveal small fixes.

- [ ] **Step 1: Run focused Matrix tests**

Run:

```bash
bun test src/utils/__tests__/matrixTacticalPresentation.test.ts src/utils/__tests__/matrixTacticalTheme.test.ts src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run broader affected tests**

Run:

```bash
bun test src/components/__tests__/StatusLine.test.tsx src/components/__tests__/SearchExtraToolsHint.test.ts src/utils/__tests__/configConstants.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect theme selector and config options manually**

Run:

```bash
rg "matrix-tactical|Matrix Tactical" src packages/@ant/ink packages/builtin-tools
```

Expected output includes:

```text
src/utils/theme.ts
packages/@ant/ink/src/theme/theme-types.ts
packages/@ant/ink/src/theme/ThemeProvider.tsx
src/components/ThemePicker.tsx
src/utils/config.ts
src/components/matrix-tactical/
```

- [ ] **Step 5: Run full type-focused verification**

Run:

```bash
bun run typecheck
```

Expected: PASS with zero TypeScript errors.

- [ ] **Step 6: Commit final fixes if any**

If no changes:

```bash
git status --short
```

Expected: no unstaged Matrix implementation changes.

If small verification fixes were needed:

```bash
git add <fixed-files>
git commit -m "fix(matrix-tactical): complete integration verification"
```

---

## Self-Review

Spec coverage:

- Complete default theme and theme registration: Tasks 2 and 3.
- Existing-user migration with guard: Task 3.
- New-component-first approach: Tasks 4 through 8.
- Startup, idle, working, permission, completed, blocked scene coverage: Tasks 4 through 8 cover visible startup, prompt/footer, tool/work, permission, status/success/error presentation. Existing message/tool result content remains unchanged.
- No right sidebar or Web terminal title bar: no planned component introduces either.
- CSC status semantics: Task 7 preserves existing status data and only changes presentation.
- ASCII progress: Tasks 1 and 6.
- Typecheck and tests: Task 9.

Placeholder scan:

- No `TBD`, `TODO`, or deferred implementation placeholders are used.
- Each code-changing task includes concrete file paths, code snippets, commands, and expected results.

Type consistency:

- Theme name is consistently `matrix-tactical`.
- Migration guard is consistently `matrixTacticalThemeMigrationVersion`.
- Presentation helper names are consistently imported from `matrixTacticalPresentation.js`.
