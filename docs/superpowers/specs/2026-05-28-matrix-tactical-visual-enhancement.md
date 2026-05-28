# Matrix Tactical 视觉增强设计

**日期**: 2026-05-28
**分支**: `docs/matrix-tactical-cli-design`
**前置**: [2026-05-27-matrix-tactical-cli-design.md](2026-05-27-matrix-tactical-cli-design.md)

## 背景

matrix-tactical 主题已完整覆盖外围元素（COSTRICT banner、状态栏、权限框、输入提示），但消息流核心区域和 loading 效果几乎没有主题专属样式——消息流全为 emerald/zinc 双色，loading 为标准 star glyph 回文序列。本次增强聚焦两个维度：

1. **消息流色彩分化** — 为消息角色、工具类型、状态信息引入更多颜色层次
2. **Loading 效果重设计** — 将平淡的 `✶ Thinking…` 替换为战术 HUD 风格

## 设计原则

- **终端兼容**：全部使用 ASCII + Unicode block elements / box-drawing / geometric shapes，零 emoji
- **新增组件优先**：在 `src/components/matrix-tactical/` 中扩展，现有组件只做主题检测+分流
- **不改数据模型**：仅改变视觉呈现，不动消息结构、工具执行逻辑、权限判定

---

## 一、Loading 效果：战术 HUD 帧

### 当前

```
✶ Thinking…  (↓ 245 tokens · 3.2s · thinking)
```

- Glyph: `✶✸✹✺✹✷` 回文序列（star），颜色 `claude` (emerald)
- 动词: `Thinking…` sentence case + 微光
- 指标: `(↓ 245 tokens · 3.2s · thinking)` 圆括号包裹

### 增强

```
◣ [THINKING]  [245t]  [3.2s]  [thinking]▌
```

| 元素 | 内容 | 颜色 | 说明 |
|------|------|------|------|
| Glyph | `◢◣◤◥` 四帧旋转 (triangle) | `cyan` (#06B6D4) | 80ms/帧，替换 star 回文 |
| 动词 | `[THINKING]` 全大写 + 方括号 | 动词 `white`，括号 `cyan` | 与现有 `[THINK]` `[RUN]` 前缀体系统一 |
| 指标 | `[245t]` `[3.2s]` `[thinking]` | 括号 `cyan`，数值 `muted`/`teal`，状态 `amber` | 三项独立方括号，verbose 模式控制显隐 |
| 光标 | `▌` (U+258C left half block) | `cyan` | 行尾闪烁 (0.7s step-end)，暗示"正在写入" |

### 改动文件

- `src/components/Spinner/SpinnerGlyph.tsx` — glyph 帧序列从 `star` 切换为 `triangle`
- `src/components/Spinner/GlimmerMessage.tsx` — 动词渲染格式：全大写 + 方括号包裹
- `src/components/Spinner/SpinnerAnimationRow.tsx` — 指标排版：方括号分栏 + 闪烁光标

---

## 二、消息流色彩分化

### 角色-颜色映射

| 角色 | 颜色 Token | 色值 | 用途 |
|------|-----------|------|------|
| 用户输入 | `text` (white) | `#FFFFFF` | 用户消息正文 |
| 助手回复 | 浅灰 | `#E2E8F0` | 助手文字，略柔和于纯白 |
| 元信息 | `muted` | `#94A3B8` | 前缀标记如 `├─` `└─` |
| 弱化文字 | `dim` | `#64748B` | 辅助描述、提示文字 |

### 工具类型 → 颜色/前缀

| 工具类型 | 前缀 | 颜色 | 边框色 | 色值 |
|----------|------|------|--------|------|
| Bash/Shell | `[RUN]` | `cyan` | cyan | `#06B6D4` |
| Read/Glob | `[READ]` | `teal` | teal | `#2DD4BF` |
| Write/Edit | `[WRITE]` | `green` (emerald) | emerald | `#34D399` |
| Grep | `[GREP]` | `purple` | purple | `#A78BFA` |
| Agent/Task | `[AGENT]` | `purple` | purple | `#A78BFA` |
| WebFetch/Search | `[WEB]` | `blue` | blue | `#60A5FA` |
| Thinking | `[THINK]` | `amber` | amber | `#F59E0B` |
| 进度/编译 | `[COMPILE]` | `amber` | amber | `#F59E0B` |
| 分析/诊断 | `[ANALYZE]` | `blue` | blue | `#60A5FA` |
| 错误 | `[ERR]` | `rose` | rose | `#FB7185` |
| 成功 | `[SUCCESS]` | `green` (emerald) | - | `#34D399` |

### 工具块左边框

每种工具执行输出块加 2px 左边框色条，用对应颜色区分类型：

```
┃ [RUN] Bash: npm install -D vitest    ← cyan 左边框
┃   OK added 45 packages in 3.2s
┃ [READ] src/cache.ts                  ← teal 左边框
┃   1  import React from 'react'
```

**实现**: 在 `MatrixToolUseLine.tsx` 中扩展 tool→color/prefix 映射，通过 Ink `<Box>` 的 `borderLeft` 属性渲染色条。

### 改动文件

- `src/components/matrix-tactical/MatrixToolUseLine.tsx` — 扩展 tool→color 映射 + 左边框渲染
- `src/components/matrix-tactical/MatrixMessageLine.tsx` — 用户/助手消息角色色
- `src/utils/matrixTacticalPresentation.ts` — 如有需要补充新颜色 token

---

## 三、状态栏分段着色

当前状态栏全部使用 `muted` 单色。增强后各指标段独立着色：

| 字段 | 颜色 | 示例 |
|------|------|------|
| `[STAT]` 前缀 | `cyan` | `[STAT]` |
| 模型名称 | `white` | `Sonnet 4.6` |
| Context | `teal` | `Context 18%` |
| Session | `amber` | `Session 3%` |
| Weekly | `purple` | `Weekly 7%` |
| 成本 | `green` | `$0.02` |
| Cache | `purple` | `Cache 82%` |
| 错误退出码 | `rose` | `last exit 1` |

### 改动文件

- `src/components/matrix-tactical/MatrixStatusLine.tsx` — 各段独立颜色

---

## 四、权限框增强

```
当前:  ==================== [ 警 告 : 权 限 提 审 ] ====================
增强:  +=======================[ !!! 权 限 提 审 !!! ]=======================+
       |                                                           |
       |  [REQ] 是否允许该 Shell 命令在您的本机运行？              |
       |  [y/N] 确认后无法逆转；直接回车默认选择 否 (N)           |
       |                                                           |
       +===========================================================+
```

- `+` `=` `|`: amber/yellow 双色边框
- `!!! 权 限 提 审 !!!`: amber 加粗，强化紧迫感
- `[REQ]`: 白色，突出行动号召

### 改动文件

- `src/components/matrix-tactical/MatrixPermissionFrame.tsx` — 边框字符和颜色替换

---

## 五、完成摘要多色分段

摘要框内标签与数值分色：

| 元素 | 颜色 | 示例 |
|------|------|------|
| 框线 | `teal` | `┌───` `│` `└───` |
| 标签 (物理用时/Tokens/) | `blue` | `物理用时:` |
| 数值 | `white` | `3.14 秒` |
| 新增行 | `green` | `+144行` |
| 删除行 | `rose` | `-12行` |
| 模型名 | `purple` | `sonnet` |
| 文件路径 | `yellow` | `/src/cache.ts` |

### 改动文件

- 摘要框在 assistant message 响应中渲染，由 `MessageResponse.tsx` + 矩阵消息组件控制

---

## 六、受阻/错误增强

| 元素 | 颜色 | 说明 |
|------|------|------|
| `[ERR]` 前缀 | `rose` | 已有 |
| 错误详情块 | `rose` 左边框 + 浅红背景 | 新增 hl-rose 样式 |
| 诊断框边框 | `rose` | 当前为 muted，改为 rose |
| 诊断框标题 | `amber` | `阻 塞 诊 断` 用 amber 突出 |
| 修复选项 (A) | `white` | 推荐选项 |
| 修复选项 (B) | `amber` | 备选/危险选项 |

### 改动文件

- `src/components/matrix-tactical/MatrixMessageLine.tsx` — 错误消息渲染增强

---

## 不改动范围

- COSTRICT ASCII banner 启动画面
- `[costrict] >>` 输入提示符
- 核心消息数据模型 (`src/types/message.ts`)
- 非 matrix-tactical 主题的任何组件
- 主题配置迁移逻辑

---

## 验收标准

1. Loading 效果在 matrix-tactical 主题下显示 triangle glyph + 方括号帧
2. 非 matrix-tactical 主题的 loading 行为不变
3. 工具执行块按类型显示不同颜色前缀和左边框
4. 状态栏各段独立着色
5. 权限框使用 amber 双线边框
6. 错误信息使用 rose 左边框高亮
7. 所有字符在 Windows Terminal / macOS Terminal / VS Code Terminal 中正确渲染（零 emoji）
8. `bun test` 全部通过
9. `bunx tsc --noEmit` 零错误
