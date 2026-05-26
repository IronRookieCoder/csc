# 右侧 Rail 常显 Progress 与 Sessions 设计

## 目标

右侧 `ActivityRail` 中的 `Progress` 和 `Sessions` 同时作为一等信息块展示，不再由运行态在二者之间互斥切换。

本设计只调整 Rail 的信息架构和渲染组织，不新增 Sessions 数据源，不改变工具管线派生逻辑，不改变顶部栏、底部栏或消息存储行为。

## 当前问题

当前 `ActivityRail.tsx` 中的 `RailHeader` 根据 `topBarState.mode` 二选一：

- `active` 时显示 `Progress`
- `idle` 时显示 `Session`

这使得 `Progress` 和 `Sessions` 无法同时出现。用户期望 `sessions` 是右侧 Rail 的一个完整类别信息块，而不是 `Progress` 的替代态。

## 设计

`ActivityRail` 继续复用现有输入：

- `state: ActivityRailState`：提供 `Change Set` 和后续质量信息
- `topBarState?: TopBarState`：提供 `pipeline`、`sessionTitle`、`branch`

将当前互斥的 `RailHeader` 拆成两个独立 section：

1. `ProgressSection`
   - 渲染 `topBarState.pipeline`
   - 每个 phase 使用现有 `PipelineRow`
   - phase 状态仍由 `deriveTopBarState()` 决定

2. `SessionsSection`
   - 渲染 `topBarState.sessionTitle`
   - 渲染 `topBarState.branch`
   - 暂不接入后台、远程或多会话列表

右侧 Rail section 顺序固定为：

```text
Progress
Sessions
Change Set
```

只要 `topBarState` 存在，`Progress` 与 `Sessions` 都显示。`topBarState.mode` 不再决定 Rail 顶部显示哪个 section；它只通过 pipeline phase 状态影响 `Progress` 内容。

如果 `topBarState` 不存在，Rail 继续降级为只显示 `Change Set`，不抛错。

## 布局约束

保持现有宽度和断点：

- `ACTIVITY_RAIL_WIDTH = 34`
- `ACTIVITY_RAIL_MIN_COLUMNS = 120`

文本继续使用 `wrap="truncate-end"`。本设计接受 Rail 纵向高度增加，不通过折叠或摘要压缩 `Sessions`。

## 非目标

- 不新增 `ActivityRailState.sessions`
- 不展示后台 sessions 列表
- 不展示远程 sessions 列表
- 不调整 `TopBar` 或 `deriveTopBarState()` 的数据模型
- 不改变窄屏摘要逻辑

## 测试

更新 `src/components/activity-rail/__tests__/ActivityRail.test.tsx`：

- 当 `topBarState.mode === 'active'` 时，同时断言存在 `Progress` 和 `Sessions` 信息
- 当 `topBarState.mode === 'idle'` 时，同时断言存在 `Progress` 和 `Sessions` 信息
- 当未传入 `topBarState` 时，Rail 仍能只渲染 `Change Set`

如现有测试快照或文本断言依赖互斥行为，需要同步调整。
