# CSC 单主题状态栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CSC 的底部状态栏改成内置单主题 Powerline 风格，并彻底移除原有 `statusLine.command` 自定义命令链路。

**Architecture:** 保留现有状态栏入口，但把数据归一、终端能力判断和渲染拆成清晰边界。`widgetBar.ts` 负责固定段数据，`WidgetBar.tsx` 负责 Powerline/ASCII 渲染，`StatusLine.tsx` 只负责显隐和组装上下文。配置层删除 `statusLine.command`，只保留 `statusLineEnabled`。

**Tech Stack:** TypeScript, React, Ink, bun:test, existing CSC settings/config UI.

---

### Task 1: 收敛 widgetBar 数据模型到固定段

**Files:**
- Modify: `src/utils/widgetBar.ts`
- Modify: `src/utils/__tests__/widgetBar.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from 'bun:test'
import { deriveWidgetBarState } from '../widgetBar.js'

describe('deriveWidgetBarState', () => {
  test('always returns the fixed csc segment order', () => {
    const result = deriveWidgetBarState({
      columns: 140,
      modelName: 'Claude Opus 4.6',
      contextUsedPct: 42,
      totalCostUsd: 1.24,
      cacheHitRate: 82,
      cacheCountdown: '12:34',
      branch: 'main',
      linesAdded: 24,
      linesRemoved: 8,
      startedAt: 1_000,
      now: 61_000,
    })

    expect(result.widgets.map(widget => widget.key)).toEqual([
      'model',
      'context',
      'cache',
      'cost',
      'branch',
    ])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/utils/__tests__/widgetBar.test.ts -t "always returns the fixed csc segment order"`
Expected: fail because `deriveWidgetBarState()` still exposes the old widget set and/or order.

- [ ] **Step 3: 写最小实现**

```ts
export type WidgetBarState = {
  widgets: WidgetItem[]
  shortcuts: string
}

export function deriveWidgetBarState(input: WidgetBarInput): WidgetBarState {
  const widgets: WidgetItem[] = [
    { key: 'model', label: compactModelName(input.modelName), tone: 'default' },
    { key: 'context', label: `ctx ${Math.round(input.contextUsedPct)}%`, tone: toneForPercent(Math.round(input.contextUsedPct)) },
    { key: 'cache', label: `Cache ${input.cacheHitRate === null ? '--' : Math.round(input.cacheHitRate)}% ${input.cacheCountdown}`, tone: input.cacheHitRate !== null && input.cacheHitRate > 50 ? 'success' : input.cacheCountdown === 'exp' ? 'muted' : 'default' },
    { key: 'cost', label: formatCost(input.totalCostUsd, 2), tone: 'default' },
    { key: 'branch', label: `${input.branch ?? '-'} ${input.linesAdded}↑${input.linesRemoved}↓`, tone: 'default' },
  ]

  return {
    widgets: widgets.filter(widget => widget.label.length > 0),
    shortcuts: input.columns < 80 ? '? Help' : 'Esc cancel · ? help · ↓ tasks',
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/utils/__tests__/widgetBar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/widgetBar.ts src/utils/__tests__/widgetBar.test.ts
git commit -m "feat: fix widget bar for single theme status line"
```

### Task 2: 将 WidgetBar 改成 Powerline + ASCII 回退渲染器

**Files:**
- Modify: `src/components/widget-bar/WidgetBar.tsx`
- Add/Modify: `src/utils/terminalCapabilities.ts`
- Add: `src/components/widget-bar/__tests__/WidgetBar.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WidgetBar } from '../WidgetBar.js'

describe('WidgetBar', () => {
  test('renders powerline separators when unicode is supported', () => {
    const html = renderToStaticMarkup(
      <WidgetBar
        columns={140}
        state={{
          widgets: [
            { key: 'model', label: 'Opus 4.6', tone: 'default' },
            { key: 'context', label: 'ctx 42%', tone: 'warning' },
          ],
          shortcuts: 'Esc cancel · ? help · ↓ tasks',
        }}
      />,
    )

    expect(html).toContain('')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/components/widget-bar/__tests__/WidgetBar.test.tsx -t "renders powerline separators when unicode is supported"`
Expected: fail because `WidgetBar` still renders plain chips.

- [ ] **Step 3: 写最小实现**

```tsx
export function WidgetBar({ state, columns }: Props): React.ReactNode {
  const [theme] = useTheme()
  const capabilities = getTerminalCapabilities(process.env, columns)
  const tokens = getDesignTokens(theme, capabilities)

  if (capabilities.supportsPowerline) {
    return (
      <Box width="100%" flexShrink={0}>
        {state.widgets.map((widget, index) => (
          <React.Fragment key={widget.key}>
            <Text color={toneColor(widget.tone, tokens)}>{widget.label}</Text>
            {index < state.widgets.length - 1 ? <Text color={inkColor(tokens.muted)}></Text> : null}
          </React.Fragment>
        ))}
        <Text color={inkColor(tokens.muted)}>{state.shortcuts}</Text>
      </Box>
    )
  }

  return (
    <Box width="100%" flexShrink={0} justifyContent="space-between">
      <Text>{state.widgets.map(widget => `[${widget.label}]`).join(' ')}</Text>
      <Text color={inkColor(tokens.muted)}>{state.shortcuts}</Text>
    </Box>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/components/widget-bar/__tests__/WidgetBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/widget-bar/WidgetBar.tsx src/utils/terminalCapabilities.ts src/components/widget-bar/__tests__/WidgetBar.test.tsx
git commit -m "feat: render single theme widget bar"
```

### Task 3: 删除自定义 statusLine.command 配置与执行链路

**Files:**
- Modify: `src/utils/settings/types.ts`
- Modify: `src/components/StatusLine.tsx`
- Modify: `src/utils/hooks.ts`
- Modify: `src/components/Settings/Config.tsx`
- Modify: `src/utils/settings/__tests__/config.test.ts`
- Modify: `src/components/PromptInput/PromptInputFooter.tsx`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from 'bun:test'
import { SettingsSchema } from '../types.js'

describe('SettingsSchema', () => {
  test('rejects statusLine.command after the field is removed', () => {
    const result = SettingsSchema.safeParse({
      statusLine: { type: 'command', command: 'echo status' },
    })

    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/utils/settings/__tests__/config.test.ts -t "rejects statusLine.command after the field is removed"`
Expected: fail while the old schema still accepts `statusLine.command`.

- [ ] **Step 3: 写最小实现**

```ts
// src/utils/settings/types.ts
statusLineEnabled: z
  .boolean()
  .optional()
  .describe('Whether to render the built-in status bar. Set false to hide it.'),

// delete the existing `statusLine: z.object({ ... })` block entirely.
// The schema should no longer accept `type: 'command'` or `command`.

// src/components/StatusLine.tsx
export function statusLineShouldDisplay(settings: ReadonlySettings): boolean {
  if (feature('KAIROS') && getKairosActive()) return false
  if (settings?.statusLineEnabled === false) return false
  return true
}

function StatusLineInner({ messagesRef, lastAssistantMessageId, vimMode }: Props): React.ReactNode {
  const settings = useSettings()
  const { columns } = useTerminalSize()
  const permissionMode = useAppState(s => s.toolPermissionContext.mode)
  const mainLoopModel = useMainLoopModel()
  const builtinRuntimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel,
    exceeds200kTokens: doesMostRecentAssistantMessageExceed200k(messagesRef.current),
  })
  const widgetBarState = statusLineShouldDisplay(settings)
    ? deriveWidgetBarState({
        columns,
        modelName: renderModelName(builtinRuntimeModel),
        contextUsedPct: Math.round(calculateContextPercentages(getCurrentUsage(messagesRef.current), getContextWindowForModel(builtinRuntimeModel, getSdkBetas())).used ?? 0),
        totalCostUsd: getTotalCost(),
        cacheHitRate: computeHitRate(getCurrentUsage(messagesRef.current)),
        cacheCountdown: '--:--',
        branch: getCurrentWorktreeSession()?.worktreeBranch,
        linesAdded: getTotalLinesAdded(),
        linesRemoved: getTotalLinesRemoved(),
        startedAt: Date.now() - getTotalDuration(),
        now: Date.now(),
      })
    : null

  return widgetBarState ? <WidgetBar state={widgetBarState} columns={columns} /> : null
}

// src/utils/hooks.ts
// delete `executeStatusLineCommand()` and the status-line execution branch
// that reads `settings.statusLine.command`.

// src/components/Settings/Config.tsx
// delete the settings row that edits the status line command and its helper
// text. The page should only keep the built-in bar toggle.
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/utils/settings/__tests__/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/settings/types.ts src/components/StatusLine.tsx src/utils/hooks.ts src/components/Settings/Config.tsx src/utils/settings/__tests__/config.test.ts src/components/PromptInput/PromptInputFooter.tsx
git commit -m "fix: remove custom status line command"
```

### Task 4: 清理状态栏相关文案和调用点

**Files:**
- Modify: `src/components/PromptInput/PromptInputFooter.tsx`
- Modify: `src/components/StatusLine.tsx`
- Modify: `src/utils/settings/types.ts`
- Modify: `src/components/Settings/Config.tsx`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from 'bun:test'
import { statusLineShouldDisplay } from '../../components/StatusLine.js'

describe('statusLineShouldDisplay', () => {
  test('still hides the built-in bar when disabled', () => {
    expect(statusLineShouldDisplay({ statusLineEnabled: false } as any)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/components/__tests__/StatusLine.test.tsx -t "still hides the built-in bar when disabled"`
Expected: fail until the status line entry is simplified to built-in-only logic.

- [ ] **Step 3: 写最小实现**

```tsx
// PromptInputFooter.tsx
{mode === 'prompt' && !isShort && !exitMessage.show && !isPasting && statusLineShouldDisplay(settings) && (
  <StatusLine messagesRef={messagesRef} lastAssistantMessageId={lastAssistantMessageId} vimMode={vimMode} />
)}

// StatusLine.tsx
// delete the mount-time trust notification, `statusLineText` state, and the
// debounce/update path that called `executeStatusLineCommand`.

// Config.tsx
// delete the UI row that binds to `settings.statusLine.command` and its
// associated description text.
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/components/__tests__/StatusLine.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PromptInput/PromptInputFooter.tsx src/components/StatusLine.tsx src/utils/settings/types.ts src/components/Settings/Config.tsx
git commit -m "refactor: simplify status line wiring"
```

### Task 5: 全量复核与收尾

**Files:**
- Validate: `src/**`

- [ ] **Step 1: 运行类型检查**

Run: `bun run typecheck`
Expected: zero TypeScript errors.

- [ ] **Step 2: 运行相关测试**

Run: `bun test src/utils/__tests__/widgetBar.test.ts src/components/widget-bar/__tests__/WidgetBar.test.tsx src/utils/settings/__tests__/config.test.ts`
Expected: PASS.

- [ ] **Step 3: 检查残留引用**

Run: `rg -n "statusLine\\.command|executeStatusLineCommand|trust blocked|tengu_status_line_mount" src`
Expected: no matches except possibly historical comments already removed in code.

- [ ] **Step 4: 最终提交**

```bash
git add src docs/superpowers/plans/2026-05-26-csc-single-theme-statusbar.md
git commit -m "feat: ship single theme status bar"
```
