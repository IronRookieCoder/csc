# 双轨 REPL 设计

## 目标

CSC 需要保持聊天对话的阅读节奏，同时让工具活动、文件变更和验证状态保持可见。默认 REPL 视图拆成两条轨道：

- 左侧：沿用现有聊天流，但从普通对话中移除工具执行细节。
- 右侧：Activity Rail，总结工具进度、变更文件和验证状态。

底层消息历史必须保持完整。本设计只改变 REPL 的可见渲染，不改变 API 上下文、会话存储、transcript 模式、导出或会话恢复。

## 范围

本设计面向 Ink 终端 REPL。

它同时覆盖 fullscreen 模式和普通滚屏模式。宽终端显示完整 rail。窄终端保持聊天流干净，并显示紧凑状态摘要，不恢复旧的工具消息混排体验。

不包含：

- Web/RCS 控制面板实现。
- 新工具执行语义。
- 新的持久化工具事件存储。
- 替换 transcript/export 行为。
- Change Package、阶段管线、Tab 或快捷动作区。

## 架构

功能应实现为现有消息流之上的展示层派生。

新增一个纯工具模块，例如 `src/utils/activityRail.ts`，输入完整消息和相关运行态，输出：

- `chatMessages`：默认 REPL 聊天视图使用的消息。隐藏 tool_use 和 tool_result 细节，同时保留用户文本、assistant 文本、系统警告、权限提示和 API 错误。
- `railState`：Activity、Change Set、Quality Gate 三类面板的结构化数据。
- `narrowSummary`：低于 rail 宽度阈值时展示的一行状态摘要。

`Messages` 继续渲染它收到的消息行，不拥有 Activity Rail 的业务规则。新的 rail 组件只消费 `railState`。

transcript 模式、导出、恢复、搜索和 API 上下文继续使用完整消息数组。

## 数据模型

`railState` 包含三个有序区域。

### Activity

Activity 把工具调用聚合成高层阶段，而不是复制原始工具日志：

- `Read`、`Glob`、`Grep` 以及类似读取/搜索工具映射为 `读取上下文`。
- 上下文读取之后、文件编辑之前的阶段映射为 `定位问题`。
- `Edit`、`MultiEdit`、`Write` 映射为 `准备改动`。
- 类似验证的 `Bash` 命令映射为 `等待验证` 或 `执行验证`。

运行状态来自消息配对结果和 `inProgressToolUseIDs`：

- 命中进行中工具的阶段是 `running`。
- 已完成的前置阶段是 `done`。
- 后续阶段是 `pending`。
- 失败工具标记为 `attention`。

未知工具可以显示为通用 Activity 项，但除非结构可识别，否则不能更新 Change Set 或 Quality Gate。

### Change Set

Change Set 聚合当前回合或最近活跃回合中的文件变更：

- `Edit`、`MultiEdit`、`Write` 贡献文件路径。
- 同一文件的多次编辑合并为一条。
- diff 统计只在能从可靠现有数据中派生时显示。无法取得统计时显示 `modified`，不要伪造 `+N -M`。

面板只显示简洁列表，不显示完整 diff。完整细节仍通过 transcript/export 路径查看。

### Quality Gate

Quality Gate 初始包含三项状态：

- `需求一致性`
- `影响范围`
- `测试验证`

状态规则：

- `需求一致性` 不自动宣称成功。assistant 总结工作后可显示 `需关注` 或 `待确认`。
- `影响范围` 在存在文件变更时显示 `需关注`，没有变更信号时显示 `待执行`。
- `测试验证` 只有在类似验证的命令成功后显示 `通过`。这类命令失败时显示 `需关注`，未运行时显示 `待执行`。

类似验证的命令包括从 Bash 输入中识别出的 test、lint、typecheck 和 build 命令。

## 布局

根据终端宽度选择完整 rail 或紧凑摘要。

初始建议阈值：`120` columns。

当宽度大于等于 `120` columns：

- 渲染两列布局。
- rail 使用约 `34ch`。
- 聊天与 rail 之间保留约 2 个终端列的间距。
- rail 区域顺序为 Activity、Change Set、Quality Gate。

当宽度小于 `120` columns：

- 渲染单列聊天。
- 不把完整工具消息恢复到聊天流。
- 在当前 assistant turn 附近或可见聊天区域底部显示 `narrowSummary`。

摘要示例：

```text
Tools: 3 done, 1 running | 2 files changed | tests pending
```

### Fullscreen 模式

fullscreen 模式中，scrollable 区域支持左侧聊天列和右侧 rail。用户在当前屏幕工作时，rail 应保持可见。

输入框必须保持稳定。如果 rail 与输入宽度冲突，实现时优先保证输入体验，不强制 rail 占满整屏高度。

### 普通滚屏模式

普通模式中，宽终端渲染快照式两列布局。当前输出同时包含左侧聊天和右侧 rail 状态，并随终端 scrollback 一起保留历史快照。

这避免要求固定右侧栏脱离终端 scrollback 模型，同时仍能在普通操作中提供真正的双轨视图。

## 错误处理

Activity Rail 派生必须是 best-effort，不能阻塞聊天主流程。

如果解析消息、工具输入或工具结果失败：

- 保留聊天渲染。
- 省略不可靠的 Change Set 或 Quality Gate 数据。
- 在有帮助时降级为通用 Activity 项。
- 不从渲染路径抛错。

特殊情况：

- 权限提示保留在聊天流。
- API 错误和系统警告保留在聊天流。
- 无法识别的 Bash 命令不影响 Quality Gate。
- 验证类 Bash 命令失败时，将 `测试验证` 标记为 `需关注`。
- transcript 和 export 继续显示完整工具细节。

## 测试

主要测试覆盖纯派生模块：

- 工具类型到 Activity 阶段的映射。
- edit/write 工具的文件路径聚合。
- diff 统计缺失时回退为 `modified`。
- 验证命令成功和失败。
- 未知工具降级。
- 窄屏摘要生成。

渲染测试覆盖：

- 默认 REPL 视图隐藏 tool_use 和 tool_result 细节消息。
- transcript 模式保留完整工具细节。
- 宽度大于等于 `120` 时渲染 rail。
- 宽度小于 `120` 时渲染紧凑摘要。
- fullscreen 和普通滚屏分支使用同一份派生状态。

实现后的验证必须包含：

```bash
bun run typecheck
```

同时为新增工具模块和被触碰的渲染组件运行聚焦 `bun test`。如果实现触碰共享消息规范化或 transcript 行为，再运行更广的测试命令。

## 实现备注

优先保持模块小而边界清晰：

- `src/utils/activityRail.ts`：派生逻辑和类型守卫。
- `src/components/activity-rail/ActivityRail.tsx`：rail 渲染。
- REPL 中只保留一层很薄的集成逻辑，用于判断宽度模式，并把 `chatMessages`、`railState` 或 `narrowSummary` 传给现有布局。

不要为了这个功能修改工具执行语义或消息持久化。如果未来需要更丰富的状态，再用单独设计引入显式事件存储。
