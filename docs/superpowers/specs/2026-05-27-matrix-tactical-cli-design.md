# Matrix Tactical CLI Design

## 背景

将 `C:\Users\SXF-Admin\Downloads\csc-cli-design-showcase\src\components\matrix-tactical` 中的 Matrix Tactical 方案迁移到 CSC CLI 终端体验中。

目标不是把 Web showcase 的布局直接搬到终端，而是把 Matrix Tactical 的终端视觉语言落到 CSC CLI 的真实 Ink 界面中。设计必须兼顾高还原性、技术可行性和高投产比。

## 已确认原则

- Matrix Tactical 新增为完整 CLI 主题，并设为默认主题。
- 已有用户也迁移到 Matrix Tactical，但不覆盖用户明确选择过的非默认主题。
- 尽可能新增 Matrix Tactical 专用组件，原组件只做主题判断和分流。
- 不引入 Web showcase 的左侧 controls、下方 specs tabs、右侧栏或终端标题栏。
- 状态栏字段以 CSC 现有 `BuiltinStatusLine + CachePill` 为准，只采用 Matrix Tactical 的位置、前缀和颜色语义。

## 视觉结构

Matrix Tactical 的 CLI 结构为单栏终端：

1. 主内容区，包含启动 banner、消息流、工具行、权限框、诊断框等。
2. 内容区末尾保留 `[costrict] >>` 风格输入光标。
3. 底部状态栏位于内容/输入区下方。

不引入右侧栏，不引入 Web showcase 的窗口标题栏。

启动 Logo 使用源方案中的 COSTRICT block banner。实现时必须保留行内空格和对齐，必要时用固定字符串数组逐行渲染。

## 六个主场景

### 启动 Startup

触点：

- `LogoV2/WelcomeV2.tsx`
- `StatusNotices`
- 初始化提示

目标：

- Matrix 主题下使用 COSTRICT block banner。
- 初始化日志使用 `[SYS]`、`[OK]` 和分隔线表达配置、认证、MCP、上下文缓存状态。

### 空闲 Idle

触点：

- `PromptInput`
- `PromptInputFooterLeftSide`
- 快捷提示
- 历史/建议提示

目标：

- 输入提示使用 `[costrict] >>` 语义。
- 空闲态提示降低噪声，保留 CSC 的快捷键、权限模式、任务提示。

### 工作 Working

触点：

- `Messages`
- `MessageRow`
- `AssistantThinkingMessage`
- `AssistantToolUseMessage`
- 折叠 read/search
- `ToolUseLoader`

目标：

- 思考和工具执行行使用 `[THINK]`、`[RUN]`、`[WRITE]` 等固定前缀。
- 进度条统一 ASCII：`[====================>.........] 70%`。
- 保留 CSC 当前消息数据结构和工具树。

### 等待权限 Permission

触点：

- `PermissionDialog`
- 各类 `*PermissionRequest`
- sticky permission footer

目标：

- 使用 amber 高强调、ASCII 审批分隔线、`[REQ]` 和 `[CUE]`。
- Bash、PowerShell、File、Web、MCP 等权限请求都走统一 Matrix 外观。
- 不改变权限判定逻辑。

### 完成 Completed

触点：

- 工具结果消息
- 系统成功消息
- turn duration
- 文件编辑/写入结果
- `StatusLine`

目标：

- 完成摘要使用 `[SUCCESS]` / `[OK]`。
- 可复用现有工具结果内容。
- 只在已有摘要/结果区域加 Matrix Tactical 包装，不生成虚假指标。

### 受阻 Blocked

触点：

- API 错误
- 工具错误
- 测试/编译失败
- 拒绝消息
- `FallbackToolUseErrorMessage`
- `UserToolErrorMessage`

目标：

- 错误行使用 `[ERR]`。
- 中断使用 `[ABORT]`。
- 诊断框使用 ASCII box。
- 如果已有恢复建议则以 `[CUE]` 展示，不凭空生成建议。

## 新增组件优先策略

新增目录建议：

```text
src/components/matrix-tactical/
```

建议组件：

- `MatrixWelcome.tsx`
  - Matrix 主题下替代 `WelcomeV2` 输出。
- `MatrixPromptFrame.tsx`
  - 负责 `[costrict] >>` 输入提示、空闲态提示和 footer 风格。
- `MatrixMessageLine.tsx`
  - 统一渲染固定前缀、颜色和缩进。
- `MatrixToolUseLine.tsx`
  - 包装工具调用显示、工具状态和 ASCII 进度条。
- `MatrixPermissionFrame.tsx`
  - 包装权限请求外框、标题和提示行。
- `MatrixStatusLine.tsx`
  - 复用 `BuiltinStatusLine + CachePill` 语义，用 Matrix 风格渲染。

新增工具：

```text
src/utils/matrixTacticalPresentation.ts
```

职责：

- 场景枚举：`startup | idle | working | waiting_permission | completed | blocked`
- 固定前缀表
- 颜色映射
- ASCII box 格式化
- ASCII progress 格式化
- 状态栏格式化辅助

原组件修改范围控制在主题判断和分流，不把 Matrix Tactical 字符串和样式散落到既有组件内部。

## 主题与颜色

新增主题名：

```text
matrix-tactical
```

颜色规范：

- 背景：near black `#090d10`
- 主强调：emerald-400 `#34d399`
- 成功：emerald-300 `#6ee7b7`
- 警告：amber-500 `#f59e0b`
- 权限强调：amber-300 `#fcd34d`
- 错误：rose-400 `#fb7185`
- 普通 meta：zinc-400 `#a1a1aa`
- dim：zinc-500 `#71717a`
- 输入正文：white

主题同步范围：

- `src/utils/theme.ts`
- `packages/@ant/ink/src/theme/theme-types.ts`
- `/theme` 选择器
- ConfigTool 的 theme options
- 默认配置与迁移逻辑

## 字符与兼容性

- 终端内不指定字体，依赖用户终端 monospace。
- 不使用 Nerd Fonts、图标字体或 emoji。
- 进度条统一 ASCII：`[====================>.........] 70%`。
- 状态前缀固定宽度，优先 3-8 字符以内。
- 框线优先保留源方案 box drawing 字符。
- ANSI-only 或低兼容环境可降级为 `====`、`----`、`|`。

## 配置迁移

默认策略：

- 新用户默认 `theme = "matrix-tactical"`。
- 旧配置缺失 theme 时解析为 `matrix-tactical`。
- 旧配置为 `dark` 且未迁移时迁移为 `matrix-tactical`。

不覆盖用户明确选择过的主题：

- `light`
- `dark-ansi`
- `light-ansi`
- `dark-daltonized`
- `light-daltonized`
- `auto`
- 未来新增主题

需要增加迁移 guard 字段，例如：

```text
matrixTacticalThemeMigrationVersion
```

迁移后用户如果手动切回 `dark`，不再自动覆盖。

## 风险控制

- 不改变消息数据模型。
- 不改变工具执行逻辑。
- 不改变权限判定逻辑。
- 不改变计费、上下文、速率限制和缓存统计逻辑。
- Matrix Tactical 只改变展示层。
- 两套主题类型必须同步更新，避免 typecheck 失败。

## 测试计划

必须通过：

```bash
bun run typecheck
```

建议测试：

- `matrix-tactical` 出现在 `ThemeName`、`ThemeSetting`、`/theme`、ConfigTool options。
- `getTheme("matrix-tactical")` 返回完整 Theme。
- 缺失 theme 迁移为 `matrix-tactical`。
- 旧默认 `dark` 迁移为 `matrix-tactical`。
- 用户选择 `light/auto/*-ansi/*-daltonized` 不被覆盖。
- 用户迁移后手动切回 `dark` 不再被覆盖。
- Matrix welcome 输出 COSTRICT block banner。
- Matrix permission frame 输出 `[REQ]` 和审批 ASCII 分隔。
- Matrix tool line 输出固定前缀和 ASCII 进度条。
- Matrix status line 保留 CSC 状态字段语义。
- 非 Matrix 主题仍走原组件。

## 验收标准

- 启动、空闲、工作、等待权限、完成、受阻 6 场景都能看到 Matrix Tactical 风格。
- 无右侧栏。
- 无 Web showcase 终端标题栏。
- 状态栏在内容/输入区下方。
- 状态栏字段以 CSC 为准。
- Logo 与源 Matrix Tactical banner 一致。
- 进度条使用 ASCII。
- `/theme` 可切换主题。
- 默认和迁移行为符合本设计。
- `bun run typecheck` 通过。
