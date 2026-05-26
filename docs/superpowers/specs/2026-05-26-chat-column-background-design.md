# 聊天主列背景色设计

## 目标

为终端 REPL 的中间聊天流增加低对比背景色，让聊天主列在顶部栏、右侧 rail 和底部输入区之间形成清晰阅读区域。

本设计只改变可见渲染层，不改变消息数据、transcript、导出、恢复、工具执行或权限流程。

## 用户选择

采用方案 A：只给聊天主列铺底。

不采用：

- 整个中间区域铺底：会把聊天与右侧 Change Set / Quality Gate 合并为一个视觉面板，削弱 rail 的独立层级。
- 单条消息行铺底：会触碰更多 `MessageRow` 渲染路径，增加虚拟滚动和长会话性能风险。

## 范围

覆盖：

- 普通滚屏模式的中间聊天主列。
- Fullscreen 模式的主 ScrollBox 聊天列。
- 宽屏双轨布局中左侧聊天列的背景。
- 窄屏单列布局中的聊天列背景。

不覆盖：

- 顶部 `TopBar`。
- 右侧 `ActivityRail` / Change Set / Quality Gate。
- 底部 Widget 栏、输入框、权限 sticky footer。
- Transcript 模式的全量查看界面。
- Modal、permission overlay、slash command overlay。

## 架构

背景色应该落在布局容器层，而不是消息行层。

普通滚屏模式中，`REPL.tsx` 已通过 `ActivityRailLayout` 包裹 `defaultScrollableContent`。背景应加在 `ActivityRailLayout` 的聊天主列容器上：

- `wide-rail` 分支：左侧聊天列使用独立背景；右侧 rail 继续绝对定位，不继承聊天背景。
- `narrow-summary` 分支：聊天内容保持同一背景，摘要行仍在背景外或使用现有默认样式，避免摘要看起来像聊天内容。
- `hidden-no-content` / `waiting-anchor` 分支：没有稳定 rail 布局时不强行铺底，避免欢迎页和锚点测量阶段产生闪烁。

Fullscreen 模式中，`FullscreenLayout` 负责主 ScrollBox 和 side rail 的空间拆分。背景应加在主列的 ScrollBox 外层或主列宽度约束容器上：

- side rail 不包含在背景内。
- bottom slot 不包含在背景内。
- sticky prompt header 和 new message pill 保持现有背景语义，避免 hover 和点击态被覆盖。

## 视觉 Token

背景色使用现有设计 token 中的低对比 surface 语义，不新增品牌色。

映射：

- True Color dark：使用 `getDesignTokens(theme, capabilities).surface`，当前 dark 值为 `#161b22`。
- True Color light：使用 `getDesignTokens(theme, capabilities).surface`，当前 light 值为 `#f6efe7`。
- indexed / basic color：使用 `getDesignTokens(theme, capabilities).surface`，当前降级值为 `userMessageBackground`。

文本、工具输出、streaming text、divider 和 markdown 颜色不改变。

## 行为

- 背景跟随聊天主列宽度，不覆盖右侧 `ACTIVITY_RAIL_WIDTH`。
- 背景不改变 padding、message row key、render range 或 virtual list item 结构。
- 长会话滚动时背景作为父容器属性存在，不为每条消息增加额外 wrapper。
- 宽度变化时背景跟随现有 `chatWidth` / `mainColumnWidth` 计算。
- 没有 conversation started 的欢迎态保持现状。

## 测试

增加或更新聚焦测试：

- `ActivityRailLayout` 宽屏时聊天主列有背景，rail 不在同一背景容器内。
- 窄屏时聊天内容仍可渲染，摘要不被错误归入聊天背景。
- Fullscreen 主列背景不影响 side rail、bottom slot 和 overlay 渲染结构。
- 非 True Color 终端 token 降级不抛错。

类型检查必须通过：

```bash
bun run typecheck
```

如改动触及组件快照或渲染断言，运行对应 `bun test` 文件。

## 风险与约束

- Ink 的 `backgroundColor` 会绘制单元格背景，必须避免覆盖 modal 和 prompt overlay。
- 背景不能通过 `MessageRow` 逐行添加，否则会增加长会话渲染成本。
- `feature()` 限制不相关，但修改 `REPL.tsx` 时仍不能把 feature 表达式提取为变量。
- 工作区已有未提交改动，实施时只修改与聊天背景相关的文件。
