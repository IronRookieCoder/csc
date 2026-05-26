# Chat Column Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为终端 REPL 的聊天主列增加低对比背景色，同时保持右侧 rail、顶部栏、底部输入区和消息行结构不变。

**Architecture:** 背景色在布局容器层解析和应用，不进入 `MessageRow`。新增一个小型纯 helper 负责从 `theme + terminal capabilities` 推导聊天背景 token，`ActivityRailLayout` 和 `FullscreenLayout` 只消费该 token 并加到主列容器。测试优先覆盖 token 降级、普通双轨/窄屏布局和 fullscreen 主列/side rail 分离。

**Tech Stack:** Bun、TypeScript strict、React 19、Ink (`@anthropic/ink`)、现有 `designTokens` / `terminalCapabilities`、`bun:test`、`renderToString`。

---

## 文件结构

- Create: `src/utils/chatColumnBackground.ts`
  - 纯函数模块。导出 `getChatColumnBackgroundColor(theme, capabilities)`，返回可直接传给 Ink `Box backgroundColor` 的颜色 token。
- Create: `src/utils/__tests__/chatColumnBackground.test.ts`
  - 覆盖 dark/light True Color 和 indexed 降级，保证使用现有 `designTokens.surface`。
- Modify: `src/components/activity-rail/ActivityRailLayout.tsx`
  - 在普通滚屏模式的聊天主列容器加背景色；wide rail 的右侧 `ActivityRail` 不在背景容器内；窄屏摘要保持在背景外。
- Modify: `src/components/activity-rail/__tests__/ActivityRail.test.tsx`
  - 增加 helper 断言，锁定普通布局中哪些分支应该应用聊天背景。
- Modify: `src/components/FullscreenLayout.tsx`
  - 在 fullscreen 主列 ScrollBox 区域加聊天背景；side rail、bottom slot、modal 不继承该背景。
- Test: `src/components/activity-rail/__tests__/ActivityRail.test.tsx`
  - 复用现有 fullscreen sizing 测试块，增加主列背景 helper 的断言。

## 现有约束

- 不修改 `src/components/Messages.tsx` 和 `src/components/MessageRow.tsx`。
- 不修改 transcript 模式渲染分支。
- 不改变 `chatWidth`、`mainColumnWidth`、`TerminalSizeContext`、`VirtualMessageList` 的结构。
- `feature()` 表达式不能被提取成变量。本计划不需要新增 feature flag。
- 工作区已有其他未提交改动，执行时只暂存本计划列出的文件。

---

### Task 1: 聊天背景 token helper

**Files:**
- Create: `src/utils/chatColumnBackground.ts`
- Create: `src/utils/__tests__/chatColumnBackground.test.ts`

- [ ] **Step 1: 写失败测试：聊天背景复用 designTokens.surface**

创建 `src/utils/__tests__/chatColumnBackground.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { getChatColumnBackgroundColor } from '../chatColumnBackground'
import type { TerminalCapabilities } from '../terminalCapabilities'

const trueColorCaps: TerminalCapabilities = {
  charset: 'unicode',
  colorDepth: 'truecolor',
  columns: 140,
  terminalFamily: 'generic',
}

const indexedCaps: TerminalCapabilities = {
  charset: 'ascii',
  colorDepth: 'indexed',
  columns: 80,
  terminalFamily: 'generic',
}

describe('chatColumnBackground', () => {
  test('uses the dark surface token for true color dark themes', () => {
    expect(getChatColumnBackgroundColor('dark', trueColorCaps)).toBe('#161b22')
  })

  test('uses the warm light surface token for true color light themes', () => {
    expect(getChatColumnBackgroundColor('light', trueColorCaps)).toBe('#f6efe7')
  })

  test('falls back to the indexed surface theme key without throwing', () => {
    expect(getChatColumnBackgroundColor('dark', indexedCaps)).toBe('userMessageBackground')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
bun test src/utils/__tests__/chatColumnBackground.test.ts
```

Expected: FAIL，错误包含 `Cannot find module '../chatColumnBackground'`。

- [ ] **Step 3: 实现最小 helper**

创建 `src/utils/chatColumnBackground.ts`：

```ts
import { getDesignTokens, type DesignTokenColor } from './designTokens.js'
import type { TerminalCapabilities } from './terminalCapabilities.js'

export function getChatColumnBackgroundColor(
  theme: string,
  capabilities: TerminalCapabilities,
): DesignTokenColor {
  return getDesignTokens(theme, capabilities).surface
}
```

- [ ] **Step 4: 运行 helper 测试确认通过**

Run:

```bash
bun test src/utils/__tests__/chatColumnBackground.test.ts
```

Expected: PASS，3 个测试通过。

- [ ] **Step 5: 提交 Task 1**

```bash
git add src/utils/chatColumnBackground.ts src/utils/__tests__/chatColumnBackground.test.ts
git commit -m "feat: add chat column background token"
```

---

### Task 2: 普通滚屏布局聊天列背景

**Files:**
- Modify: `src/components/activity-rail/ActivityRailLayout.tsx`
- Modify: `src/components/activity-rail/__tests__/ActivityRail.test.tsx`

- [ ] **Step 1: 写失败测试：普通布局背景策略**

在 `src/components/activity-rail/__tests__/ActivityRail.test.tsx` 的 `ActivityRailLayout` import 列表中加入新 helper：

```ts
  getActivityRailChatBackgroundColor,
```

在 `describe('ActivityRailLayout', () => { ... })` 内加入测试：

```ts
  test('applies chat background only when conversation layout is stable', () => {
    expect(
      getActivityRailChatBackgroundColor({
        branch: 'wide-rail',
        theme: 'dark',
        capabilities: {
          charset: 'unicode',
          colorDepth: 'truecolor',
          columns: 140,
          terminalFamily: 'generic',
        },
      }),
    ).toBe('#161b22')

    expect(
      getActivityRailChatBackgroundColor({
        branch: 'narrow-summary',
        theme: 'light',
        capabilities: {
          charset: 'unicode',
          colorDepth: 'truecolor',
          columns: 100,
          terminalFamily: 'generic',
        },
      }),
    ).toBe('#f6efe7')

    expect(
      getActivityRailChatBackgroundColor({
        branch: 'hidden-no-content',
        theme: 'dark',
        capabilities: {
          charset: 'unicode',
          colorDepth: 'truecolor',
          columns: 140,
          terminalFamily: 'generic',
        },
      }),
    ).toBeUndefined()

    expect(
      getActivityRailChatBackgroundColor({
        branch: 'waiting-anchor',
        theme: 'dark',
        capabilities: {
          charset: 'unicode',
          colorDepth: 'truecolor',
          columns: 140,
          terminalFamily: 'generic',
        },
      }),
    ).toBeUndefined()
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
bun test src/components/activity-rail/__tests__/ActivityRail.test.tsx
```

Expected: FAIL，错误包含 `has no exported member 'getActivityRailChatBackgroundColor'`。

- [ ] **Step 3: 在 ActivityRailLayout 实现背景策略和接线**

修改 `src/components/activity-rail/ActivityRailLayout.tsx`。

把 `useTheme` 合并进现有 `@anthropic/ink` import：

```ts
import { Box, type DOMElement, TerminalSizeContext, Text, useTerminalSize, useTheme } from '@anthropic/ink';
```

增加其他 imports：

```ts
import { getChatColumnBackgroundColor } from '../../utils/chatColumnBackground.js';
import type { DesignTokenColor } from '../../utils/designTokens.js';
```

把已有 terminalCapabilities import 合并为：

```ts
import {
  getTerminalCapabilities,
  type TerminalCapabilities,
  type TerminalCharset,
  type TerminalColorDepth,
} from '../../utils/terminalCapabilities.js';
```

在 `type Props` 后加入分支类型和 helper：

```ts
type ActivityRailLayoutBranch = 'hidden-no-content' | 'narrow-summary' | 'waiting-anchor' | 'wide-rail';

export function getActivityRailChatBackgroundColor({
  branch,
  theme,
  capabilities,
}: {
  branch: ActivityRailLayoutBranch;
  theme: string;
  capabilities: TerminalCapabilities;
}): DesignTokenColor | undefined {
  if (branch === 'hidden-no-content' || branch === 'waiting-anchor') return undefined;
  return getChatColumnBackgroundColor(theme, capabilities);
}
```

在 `ActivityRailLayout` 函数内 `const terminalSize = useTerminalSize();` 后加入：

```ts
  const [theme] = useTheme();
```

把 `branch` 变量标注为 helper 类型：

```ts
  const branch: ActivityRailLayoutBranch = !hasContent
    ? 'hidden-no-content'
    : !isWide
      ? 'narrow-summary'
      : anchorRef !== undefined && anchorTop === null
        ? 'waiting-anchor'
        : 'wide-rail';
```

在 `railPaddingTop` 后加入：

```ts
  const backgroundCapabilities = getTerminalCapabilities(
    process.env,
    columns,
  );
  const chatBackgroundColor = getActivityRailChatBackgroundColor({
    branch,
    theme,
    capabilities: backgroundCapabilities,
  });
```

把窄屏分支从：

```tsx
      <Box flexDirection="column">
        {children}
        <Text wrap="truncate-end">{narrowSummary}</Text>
      </Box>
```

改为：

```tsx
      <Box flexDirection="column">
        <Box flexDirection="column" backgroundColor={chatBackgroundColor}>
          {children}
        </Box>
        <Text wrap="truncate-end">{narrowSummary}</Text>
      </Box>
```

把宽屏主列容器从：

```tsx
        <Box flexDirection="column" width={columns} paddingTop={chatPaddingTop}>
          {children}
        </Box>
```

改为：

```tsx
        <Box
          flexDirection="column"
          width={chatWidth}
          paddingTop={chatPaddingTop}
          backgroundColor={chatBackgroundColor}
        >
          {children}
        </Box>
```

保持右侧 rail 的 absolute Box 不变。

- [ ] **Step 4: 运行普通布局测试确认通过**

Run:

```bash
bun test src/components/activity-rail/__tests__/ActivityRail.test.tsx
```

Expected: PASS。现有宽度相关断言仍应通过：

- `header-columns:125`
- `child-columns:91`
- welcome top line 长度仍大于等于 120

- [ ] **Step 5: 提交 Task 2**

```bash
git add src/components/activity-rail/ActivityRailLayout.tsx src/components/activity-rail/__tests__/ActivityRail.test.tsx
git commit -m "feat: add chat background to activity layout"
```

---

### Task 3: Fullscreen 主列背景

**Files:**
- Modify: `src/components/FullscreenLayout.tsx`
- Modify: `src/components/activity-rail/__tests__/ActivityRail.test.tsx`

- [ ] **Step 1: 写失败测试：fullscreen 背景只应用主列稳定区域**

在 `src/components/activity-rail/__tests__/ActivityRail.test.tsx` 的 `FullscreenLayout` import 列表中加入：

```ts
  getFullscreenMainBackgroundColor,
```

在 `describe('FullscreenLayout side rail sizing', () => { ... })` 内加入测试：

```ts
  test('uses chat background for the fullscreen main column only', () => {
    expect(
      getFullscreenMainBackgroundColor({
        theme: 'dark',
        capabilities: {
          charset: 'unicode',
          colorDepth: 'truecolor',
          columns: 140,
          terminalFamily: 'generic',
        },
      }),
    ).toBe('#161b22')

    expect(
      getFullscreenMainBackgroundColor({
        theme: 'dark',
        capabilities: {
          charset: 'ascii',
          colorDepth: 'indexed',
          columns: 80,
          terminalFamily: 'generic',
        },
      }),
    ).toBe('userMessageBackground')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
bun test src/components/activity-rail/__tests__/ActivityRail.test.tsx
```

Expected: FAIL，错误包含 `has no exported member 'getFullscreenMainBackgroundColor'`。

- [ ] **Step 3: 在 FullscreenLayout 实现背景 helper**

修改 `src/components/FullscreenLayout.tsx`。

把 `useTheme` 合并进现有 `@anthropic/ink` import：

```ts
import {
  Box,
  ScrollBox,
  TerminalSizeContext,
  type ScrollBoxHandle,
  Text,
  instances,
  useTheme,
} from '@anthropic/ink';
```

增加其他 imports：

```ts
import { getChatColumnBackgroundColor } from '../utils/chatColumnBackground.js';
import type { DesignTokenColor } from '../utils/designTokens.js';
import {
  getTerminalCapabilities,
  type TerminalCapabilities,
} from '../utils/terminalCapabilities.js';
```

在 `getFullscreenSideRailPaddingTopForAnchor` 后加入 helper：

```ts
export function getFullscreenMainBackgroundColor({
  theme,
  capabilities,
}: {
  theme: string;
  capabilities: TerminalCapabilities;
}): DesignTokenColor {
  return getChatColumnBackgroundColor(theme, capabilities);
}
```

- [ ] **Step 4: 在 fullscreen 主列容器接线背景**

在 `FullscreenLayout` 函数内 `const { rows: terminalRows, columns } = useTerminalSize();` 后加入：

```ts
  const [theme] = useTheme();
```

在 fullscreen 分支内 `const mainTerminalSize = ...` 后加入：

```ts
    const mainBackgroundColor = getFullscreenMainBackgroundColor({
      theme,
      capabilities: getTerminalCapabilities(process.env, mainColumnWidth),
    });
```

把包裹 `top/headerPrompt/ScrollBox/bottomFloat` 的内部 Box 从：

```tsx
              <Box flexGrow={1} flexDirection="column" overflow="hidden">
```

改为：

```tsx
              <Box
                flexGrow={1}
                flexDirection="column"
                overflow="hidden"
                backgroundColor={mainBackgroundColor}
              >
```

不要把背景加到 bottom slot 外层：

```tsx
              <Box flexDirection="column" flexShrink={0} width="100%" maxHeight="50%">
```

这一段保持不变，确保输入区不继承聊天背景。

- [ ] **Step 5: 运行 fullscreen/layout 测试确认通过**

Run:

```bash
bun test src/components/activity-rail/__tests__/ActivityRail.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 运行类型检查**

Run:

```bash
bun run typecheck
```

Expected: PASS，`bunx tsc --noEmit` 零错误。

- [ ] **Step 7: 提交 Task 3**

```bash
git add src/components/FullscreenLayout.tsx src/components/activity-rail/__tests__/ActivityRail.test.tsx
git commit -m "feat: add chat background to fullscreen layout"
```

---

### Task 4: 最终回归与工作区检查

**Files:**
- Verify only; no planned source edits.

- [ ] **Step 1: 运行聚焦测试**

Run:

```bash
bun test src/utils/__tests__/chatColumnBackground.test.ts src/components/activity-rail/__tests__/ActivityRail.test.tsx
```

Expected: PASS。

- [ ] **Step 2: 运行类型检查**

Run:

```bash
bun run typecheck
```

Expected: PASS。

- [ ] **Step 3: 检查 diff 只包含计划范围**

Run:

```bash
git status --short
git diff --stat
```

Expected: 没有未提交的计划范围内改动。允许看到执行前已存在的无关工作区改动，但不要暂存或回滚它们。

- [ ] **Step 4: 如有遗漏，提交收尾修正**

只有当 Step 1 或 Step 2 需要小修正时执行：

```bash
git add src/utils/chatColumnBackground.ts src/utils/__tests__/chatColumnBackground.test.ts src/components/activity-rail/ActivityRailLayout.tsx src/components/activity-rail/__tests__/ActivityRail.test.tsx src/components/FullscreenLayout.tsx
git commit -m "fix: tighten chat column background layout"
```

Expected: 如果没有遗漏，不创建额外提交。
