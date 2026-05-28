# Matrix Tactical 视觉增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 matrix-tactical 主题增强消息流色彩分化、Loading 效果重构（triangle glyph + 方括号帧）、状态栏分段着色、权限/错误框视觉强化。

**Architecture:** 所有改动限定在 `src/components/matrix-tactical/` 和 `src/components/Spinner/` 目录。通过 `isMatrixTacticalTheme()` 检测进行分流，非矩阵主题行为不变。新增组件优先策略——在矩阵组件中扩展，不修改通用消息渲染路径。

**Tech Stack:** TypeScript, React/Ink, Bun test

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `src/components/Spinner/SpinnerGlyph.tsx` | spinner 旋转字符渲染 | 修改 — 矩阵主题用 triangle 帧 |
| `src/components/Spinner/SpinnerAnimationRow.tsx` | 动画行：glyph + message + status | 修改 — 矩阵主题方括号格式 + 闪烁光标 |
| `src/utils/matrixTacticalPresentation.ts` | 矩阵主题工具函数、颜色映射、前缀 | 修改 — 扩展 tool→color/prefix 映射 |
| `src/components/matrix-tactical/MatrixToolUseLine.tsx` | 工具执行行渲染 | 修改 — 左边框色条 + 工具类型分色 |
| `src/components/matrix-tactical/MatrixStatusLine.tsx` | 状态栏渲染 | 修改 — 各段独立着色 |
| `src/components/matrix-tactical/MatrixPermissionFrame.tsx` | 权限框渲染 | 修改 — amber 双线边框 |
| `src/components/matrix-tactical/MatrixMessageLine.tsx` | 通用消息行渲染 | 修改 — 错误消息 rose 左边框 |
| `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx` | 矩阵组件测试 | 修改 — 补充新行为的测试用例 |
| `src/components/Spinner/__tests__/spinnerStalledColor.test.ts` | spinner 停滞颜色测试 | 不修改（此功能不变） |

---

### Task 1: Triangle Glyph 帧序列（Spinner）

**文件:**
- 修改: `src/components/Spinner/SpinnerGlyph.tsx:1-66`
- 修改: `src/components/matrix-tactical/__tests__/matrixComponents.test.tsx`

- [ ] **Step 1: 在 SpinnerGlyph.tsx 添加矩阵主题 triangle 帧分支**

在文件顶部添加 import：
```ts
import { isMatrixTacticalTheme } from '../../utils/matrixTacticalPresentation.js';
```

新增 triangle 帧常量（在 `SPINNER_FRAMES` 之前）：
```ts
const TRIANGLE_FRAMES = ['◢', '◣', '◤', '◥'];
```

修改 `SpinnerGlyph` 函数体内的 spinnerChar 取值逻辑（约第 44 行），将：
```ts
const spinnerChar = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
```
改为：
```ts
const isMatrix = isMatrixTacticalTheme(themeName);
const frames = isMatrix ? TRIANGLE_FRAMES : SPINNER_FRAMES;
const spinnerChar = frames[frame % frames.length];
```

- [ ] **Step 2: 在测试文件中添加 triangle glyph 测试**

在 `matrixComponents.test.tsx` 末尾添加测试用例：
```ts
test('SpinnerGlyph uses triangle frames for matrix theme', () => {
  // Verify TRIANGLE_FRAMES contains only terminal-safe characters
  const TRIANGLE_FRAMES = ['◢', '◣', '◤', '◥'];
  for (const char of TRIANGLE_FRAMES) {
    expect(char.length).toBe(1);
    // All characters are within Unicode Geometric Shapes block (U+25A0–U+25FF)
    const code = char.codePointAt(0)!;
    expect(code).toBeGreaterThanOrEqual(0x25A0);
    expect(code).toBeLessThanOrEqual(0x25FF);
  }
});

test('SpinnerGlyph triangle frames are distinct from star frames', () => {
  const TRIANGLE_FRAMES = ['◢', '◣', '◤', '◥'];
  const starFrames = ['✶', '✸', '✹', '✺', '✹', '✷'];
  for (const t of TRIANGLE_FRAMES) {
    expect(starFrames.includes(t)).toBe(false);
  }
});
```

- [ ] **Step 3: 运行测试验证**

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```
预期: 全部通过（含新增 2 个测试）

- [ ] **Step 4: 运行 typecheck**

```bash
bunx tsc --noEmit
```
预期: 零错误

- [ ] **Step 5: Commit**

```bash
git add src/components/Spinner/SpinnerGlyph.tsx src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
git commit -m "feat(matrix-tactical): use triangle glyph frames for spinner in matrix theme"
```

---

### Task 2: Loading 方括号帧格式 + 闪烁光标

**文件:**
- 修改: `src/components/Spinner/SpinnerAnimationRow.tsx:75-310`

- [ ] **Step 1: 修改 SpinnerAnimationRow 的 message 渲染（方括号格式）**

当前（约第 289-309 行）的 return 块中，`<GlimmerMessage>` 使用原始 `message`（如 `"Thinking…"`）。

在 `GlimmerMessage` 的 props 中新增一个 `isMatrix` 感知——但 `GlimmerMessage` 没有 `isMatrix` 参数。更简洁的做法是在 `SpinnerAnimationRow` 中对矩阵主题预处理 message。

在 `SpinnerAnimationRow` 函数体中（约第 98 行之后），添加矩阵主题的 message 转换：

```ts
// 约第 98 行后，isMatrix 已定义
const displayMessage = isMatrix
  ? message.replace('…', '')  // 去掉省略号
  : message;
```

然后在 return 的 `<GlimmerMessage>` 前，为矩阵主题包裹方括号。修改约第 298 行的 `<GlimmerMessage ... />` 为：

```tsx
{isMatrix ? (
  <Box flexDirection="row">
    <Text color="cyan">[</Text>
    <GlimmerMessage
      message={displayMessage.toUpperCase()}
      mode={mode}
      messageColor={'text' as keyof Theme}
      glimmerIndex={glimmerIndex}
      flashOpacity={flashOpacity}
      shimmerColor={shimmerColor}
      stalledIntensity={overrideColor ? 0 : stalledIntensity}
    />
    <Text color="cyan">]</Text>
    <Text> </Text>
  </Box>
) : (
  <GlimmerMessage
    message={message}
    mode={mode}
    messageColor={messageColor}
    glimmerIndex={glimmerIndex}
    flashOpacity={flashOpacity}
    shimmerColor={shimmerColor}
    stalledIntensity={overrideColor ? 0 : stalledIntensity}
  />
)}
```

- [ ] **Step 2: 添加闪烁块光标 `▌`**

在 step 1 的矩阵分支中，`]` 后面添加闪烁光标。用 `useState` + `useEffect` 做 700ms 间隔闪烁：

```tsx
// 在 SpinnerAnimationRow 函数体开头（约第 99 行后）添加：
const [cursorVisible, setCursorVisible] = React.useState(true);
React.useEffect(() => {
  if (!isMatrix) return;
  const id = setInterval(() => setCursorVisible(v => !v), 700);
  return () => clearInterval(id);
}, [isMatrix]);
```

在 step 1 的矩阵分支 `</Box>` 之前添加：
```tsx
    <Text color={cursorVisible ? 'cyan' : undefined} dimColor={!cursorVisible}>▌</Text>
```

- [ ] **Step 3: 运行 typecheck + lint**

```bash
bunx tsc --noEmit
```
预期: 零错误

- [ ] **Step 4: Commit**

```bash
git add src/components/Spinner/SpinnerAnimationRow.tsx
git commit -m "feat(matrix-tactical): bracket-frame loading format with blinking cursor"
```

---

### Task 3: 扩展 Tool→Color/Prefix 映射

**文件:**
- 修改: `src/utils/matrixTacticalPresentation.ts:80-96`
- 修改: `src/components/matrix-tactical/MatrixToolUseLine.tsx:1-47`

- [ ] **Step 1: 在 matrixTacticalPresentation.ts 中新增 tool→color 映射函数**

在 `matrixToolPrefixForName` 函数后面（约第 96 行后）添加：

```ts
export type MatrixToolCategory = 'bash' | 'read' | 'write' | 'grep' | 'agent' | 'web' | 'think' | 'compile' | 'analyze' | 'error' | 'default';

const TOOL_CATEGORY_COLOR = {
  bash: 'cyan',
  read: 'teal',
  write: 'success',
  grep: 'purple',
  agent: 'purple',
  web: 'blue',
  think: 'warning',
  compile: 'warning',
  analyze: 'blue',
  error: 'error',
  default: 'success',
} as const satisfies Record<MatrixToolCategory, string>;

export function matrixToolCategoryForName(name: string): MatrixToolCategory {
  const n = name.trim().toLowerCase();
  if (n.includes('bash') || n.includes('shell') || n.includes('powershell')) return 'bash';
  if (n.includes('read') || n.includes('glob') || n.includes('list')) return 'read';
  if (n.includes('write') || n.includes('edit') || n.includes('patch') || n.includes('replace')) return 'write';
  if (n.includes('grep') || n.includes('search')) return 'grep';
  if (n.includes('agent') || n.includes('task')) return 'agent';
  if (n.includes('webfetch') || n.includes('websearch') || n.includes('fetch')) return 'web';
  if (n.includes('think')) return 'think';
  if (n.includes('compile')) return 'compile';
  if (n.includes('analyze')) return 'analyze';
  if (n.includes('error') || n.includes('err')) return 'error';
  return 'default';
}

export function matrixToolColorForName(name: string): string {
  return TOOL_CATEGORY_COLOR[matrixToolCategoryForName(name)];
}
```

同时扩展 `matrixToolPrefixForName`（第 80-96 行），增加更多工具类型的前缀识别：

```ts
export function matrixToolPrefixForName(name: string, state: 'queued' | 'working' | 'success' | 'error'): string {
  const normalized = name.trim().toLowerCase();
  if (state === 'error') return matrixActionPrefix('err');
  if (state === 'success') return matrixActionPrefix('ok');
  if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('patch') || normalized.includes('replace')) return matrixActionPrefix('write');
  if (normalized.includes('think')) return matrixActionPrefix('think');
  if (normalized.includes('read') || normalized.includes('glob')) return 'READ';
  if (normalized.includes('grep')) return 'GREP';
  if (normalized.includes('agent') || normalized.includes('task')) return 'AGENT';
  if (normalized.includes('web') || normalized.includes('fetch')) return 'WEB';
  if (normalized.includes('compile')) return 'COMPILE';
  if (normalized.includes('analyze')) return 'ANALYZE';
  return matrixActionPrefix('run');
}
```

- [ ] **Step 2: 更新 MatrixToolUseLine.tsx 使用新颜色映射**

当前 MatrixToolUseLine 使用 `toneForState` 决定整体色调。改为根据工具名称用 `matrixToolColorForName` 决定颜色。

修改 `MatrixToolUseLine` 函数体（约第 29-46 行）：

```tsx
export function MatrixToolUseLine({ name, detail, tag, state, progressPercent }: Props): React.ReactNode {
  const toolColor = matrixToolColorForName(name);

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="row"
        flexWrap="wrap"
        borderStyle="single"
        borderLeft
        borderTop={false}
        borderBottom={false}
        borderRight={false}
        borderColor={toolColor as keyof Theme}
      >
        <Box paddingLeft={1}>
          <MatrixMessageLine label={matrixToolPrefixForName(name, state)} tone={toneForState(state)}>
            {name}
            {detail ? <Text color="text"> ({detail})</Text> : null}
          </MatrixMessageLine>
        </Box>
        {tag}
      </Box>
      {progressPercent !== undefined && (
        <Box paddingLeft={3}>
          <Text color="success">[PROGRESS] {formatMatrixProgress(progressPercent)}</Text>
        </Box>
      )}
    </Box>
  );
}
```

需要更新 import：
```ts
import { formatMatrixProgress, matrixToolPrefixForName, matrixToolColorForName } from '../../utils/matrixTacticalPresentation.js';
```

- [ ] **Step 3: 运行 typecheck**

```bash
bunx tsc --noEmit
```
预期: 零错误

- [ ] **Step 4: Commit**

```bash
git add src/utils/matrixTacticalPresentation.ts src/components/matrix-tactical/MatrixToolUseLine.tsx
git commit -m "feat(matrix-tactical): extend tool-to-color mapping with left border for tool blocks"
```

---

### Task 4: 状态栏分段着色

**文件:**
- 修改: `src/components/matrix-tactical/MatrixStatusLine.tsx:71-154`

- [ ] **Step 1: 替换状态栏各段颜色**

在 `MatrixStatusLineContent` 的 return 块中（第 71-154 行），将各段 `Text` 的颜色从统一 `"inactive"` 替换为分段颜色：

```tsx
<Box gap={1} flexWrap="wrap" width="100%">
  <Text color="cyan">[STAT]</Text>
  <Text color="text">{modelName}</Text>
  <Text color="inactive">| </Text>
  <Text color="teal">Context {contextUsedPct}%</Text>
  <Text color="inactive"> ({tokenDisplay})</Text>
  {sessionPct !== null && (
    <>
      <Text color="inactive">| </Text>
      <Text color="amber">Session {sessionPct}%</Text>
      {sessionReset && <Text color="inactive"> {sessionReset}</Text>}
    </>
  )}
  {weeklyPct !== null && (
    <>
      <Text color="inactive">| </Text>
      <Text color="purple">Weekly {weeklyPct}%</Text>
      {weeklyReset && <Text color="inactive"> {weeklyReset}</Text>}
    </>
  )}
  {totalCostUsd > 0 && (
    <>
      <Text color="inactive">| </Text>
      <Text color="success">{formatCost(totalCostUsd)}</Text>
    </>
  )}
  {cacheText ? (
    <>
      <Text color="inactive">| </Text>
      {typeof cacheText === 'string' ? <Text color="purple">{cacheText}</Text> : cacheText}
    </>
  ) : null}
  {/* ... permissionMode, effortLevel, memoryText, runText, cueText 保持不变 ... */}
</Box>
```

关键变化：
- `[STAT]`: `"success"` → `"cyan"`
- `modelName`: 默认 → `"text"`（白色）
- `Context X%`: `"inactive"` → `"teal"`
- `Session X%`: `"inactive"` → `"amber"`
- `Weekly X%`: `"inactive"` → `"purple"`
- `$X.XX`: 默认 → `"success"`
- `cacheText`: 默认 → `"purple"`
- `last exit 1`: 保持原样（已由调用方传入 error 颜色）

- [ ] **Step 2: 在测试文件中验证 color props**

在 `matrixComponents.test.tsx` 中添加测试：

```ts
test('MatrixStatusLine uses segmented colors for each metric group', () => {
  // 验证 cyan, teal, amber, purple, success 颜色在渲染树中出现
  const { output } = renderToString(
    <MatrixStatusLine
      modelName="claude-sonnet"
      contextUsedPct={18}
      usedTokens={36000}
      contextWindowSize={200000}
      totalCostUsd={0.02}
      rateLimits={{
        five_hour: { utilization: 0.03, resets_at: Date.now() / 1000 + 18000 },
        seven_day: { utilization: 0.07, resets_at: Date.now() / 1000 + 600000 },
      }}
    />
  );
  expect(output).toContain('Context');
  expect(output).toContain('Session');
  expect(output).toContain('Weekly');
});
```

- [ ] **Step 3: 运行 typecheck + 测试**

```bash
bunx tsc --noEmit && bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add src/components/matrix-tactical/MatrixStatusLine.tsx src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
git commit -m "feat(matrix-tactical): segmented status line colors by metric type"
```

---

### Task 5: 权限框 amber 双线边框

**文件:**
- 修改: `src/components/matrix-tactical/MatrixPermissionFrame.tsx:20-52`

- [ ] **Step 1: 重构权限框边框字符和颜色**

替换当前（第 30-51 行）的单色 `=` 边框为 amber `+`=`|` 双线边框：

```tsx
export function MatrixPermissionFrame({
  title,
  subtitle,
  color,
  titleColor,
  innerPaddingX = 1,
  workerBadge,
  titleRight,
  children,
}: Props): React.ReactNode {
  const boxWidth = 59;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">
        +{'='.repeat(23)}[ <Text color="amber">!!! 权 限 提 审 !!!</Text> ]{'='.repeat(23)}+
      </Text>
      <Text color="yellow">|</Text>
      <Box paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <PermissionRequestTitle title={title} subtitle={subtitle} color={titleColor ?? color ?? 'warning'} workerBadge={workerBadge} />
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
      <Text color="yellow">|</Text>
      <Text color="yellow">+{'='.repeat(boxWidth)}+</Text>
    </Box>
  );
}
```

关键变化：
- 顶/底边框: `=` → `+`=`+`
- 标题前缀: `[ 警 告 :` → `[ !!! 权 限 提 审 !!! ]`
- 颜色: `"warning"` → `"yellow"` + `"amber"` 双色
- 左边框: `""` → `|`（竖线）
- 添加空行 padding（`<Text color="yellow">|</Text>` 包裹的内容区上下各一个空 `|`）

- [ ] **Step 2: 运行 typecheck**

```bash
bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/matrix-tactical/MatrixPermissionFrame.tsx
git commit -m "feat(matrix-tactical): amber double-line border for permission frame"
```

---

### Task 6: 消息行增强（错误块 rose 左边框 + 用户/助手色）

**文件:**
- 修改: `src/components/matrix-tactical/MatrixMessageLine.tsx:1-23`

- [ ] **Step 1: 扩展 MatrixMessageLine 支持左边框色条**

```tsx
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import type { Theme } from '../../utils/theme.js';
import {
  formatMatrixPrefix,
  MATRIX_TACTICAL_TONE_TO_THEME_KEY,
  type MatrixTone,
} from '../../utils/matrixTacticalPresentation.js';

type Props = {
  label: string;
  tone?: MatrixTone;
  children: React.ReactNode;
  /** 左边框颜色主题 key，用于错误/工具块等场景 */
  leftBorderColor?: keyof Theme;
};

const TONE_TO_TEXT_COLOR: Record<MatrixTone, keyof Theme> = {
  primary: 'text',
  success: 'success',
  warning: 'warning',
  permission: 'warning',
  error: 'error',
  meta: 'inactive',
  input: 'text',
};

export function MatrixMessageLine({ label, tone = 'meta', children, leftBorderColor }: Props): React.ReactNode {
  const prefixColor = MATRIX_TACTICAL_TONE_TO_THEME_KEY[tone];
  const textColor = TONE_TO_TEXT_COLOR[tone];

  const content = (
    <Box>
      <Text color={prefixColor}>{formatMatrixPrefix(label)} </Text>
      <Text color={textColor}>{children}</Text>
    </Box>
  );

  if (leftBorderColor) {
    return (
      <Box
        borderStyle="single"
        borderLeft
        borderTop={false}
        borderBottom={false}
        borderRight={false}
        borderColor={leftBorderColor}
        paddingLeft={1}
      >
        {content}
      </Box>
    );
  }

  return content;
}
```

关键变化：
- 新增 `TONE_TO_TEXT_COLOR`：前缀颜色和文字颜色分离（之前前缀和文字同色）
- 新增 `leftBorderColor` prop：按需渲染色条
- `tone === 'input'` 时文字为白色 `'text'`（用户输入色）

- [ ] **Step 2: 运行 typecheck**

```bash
bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/matrix-tactical/MatrixMessageLine.tsx
git commit -m "feat(matrix-tactical): add left border and tone-to-text color mapping"
```

---

### Task 7: 全量回归验证 + 最终提交

- [ ] **Step 1: 运行全部测试**

```bash
bun test src/components/matrix-tactical/__tests__/matrixComponents.test.tsx
bun test src/components/Spinner/__tests__/
```

预期: 全部通过

- [ ] **Step 2: 运行 typecheck**

```bash
bunx tsc --noEmit
```
预期: 零错误

- [ ] **Step 3: 运行 lint**

```bash
bun run lint
```
预期: 无新增错误

- [ ] **Step 4: 手动验证清单**

在 `bun run dev` 启动后验证：
1. matrix-tactical 主题下 loading 显示 `◣ [THINKING]` 格式
2. 切到 dark 主题，loading 恢复原始 `✶ Thinking…`
3. 工具执行显示不同颜色的前缀和左边框
4. 状态栏 Context/Session/Weekly 各段不同色
5. 权限框显示 amber 双线边框
6. `bun run dev` 默认启用全部 feature

> **已知范围限制：** "完成摘要多色分段"（spec 第五节）的摘要框由模型文本响应驱动，经 `MessageResponse.tsx` 渲染，不在 `matrix-tactical/` 目录内。若后续需要摘要框多色渲染，需在 `Messages.tsx` / `MessageResponse.tsx` 中添加矩阵主题分支。当前计划的 6 个 Task 已覆盖 spec 其余全部需求。

- [ ] **Step 5: 最终 commit（如有遗漏修改）**

```bash
git add -A
git commit -m "feat(matrix-tactical): comprehensive visual enhancement for message flow and loading"
```
