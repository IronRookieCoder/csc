# CSC 轨道网格 CLI UI 设计

## 背景

CSC 需要一个独特的终端 CLI UI 和 UX 方向，以区别于当前的风格、现有的竞争对手以及常见的 AI 聊天模板。首个交付物是一个基于浏览器的静态演示，展示五种必需状态下的提议终端风格：

- 启动 (startup)
- 空闲 (idle)
- 工作中并等待权限 (working and waiting for permission)
- 完成 (complete)
- 阻塞 (blocked)

该演示旨在用于内部审查和外部展示。它在视觉上应具有记忆点，但设计必须服务于 CLI 工作：状态必须清晰，决策必须简单，且实现路径必须保持低成本。

## 确认方向

选定的方向是 **CSC Orbital Mesh / 轨道网格舱**。

CSC 被呈现为一个可控的任务容器，而非通用的聊天终端。用户输入变为“指令注入”，助手工作变为“轨道执行”，权限提示变为“人工检查点”，终端结果变为明确的“对接”或“漂移”状态。

浏览器演示应采用 **展示型设计系统页面 (showcase design-system page)** 的方法：

- 一个强有力的首屏终端预览，用于截图和外部分享
- 一个五状态场景部分，用于内部审查
- 一个紧凑的设计系统部分，记录令牌 (tokens)、符号、状态、动效和可行性

## 设计记忆点

### 轨道状态栏 (Orbital Status Rail)

每个场景都使用一个紧凑的状态栏：

```text
BOOT -> IDLE -> CHECKPOINT -> COMPLETE -> BLOCKED
```

活动状态显示为信标 (beacon)。状态栏让用户立即了解他们在工作流中的位置，以及系统是正在运行、暂停还是已完成。

### 信标符号系统 (Beacon Symbol System)

使用一组少量的终端安全符号：

| 状态 | 主要符号 | ANSI 回退符号 | 含义 |
| --- | --- | --- | --- |
| 启动 | `◎` | `*` | 启动对齐 |
| 空闲 | `◌` | [o](file://d:\code\csc\packages\@ant\ink\src\core\yoga-layout\index.ts#L999-L999) | 待机轨道 |
| 权限 | `◍` | [@](file://d:\code\csc\packages\@ant\ink\src\core\yoga-layout\index.ts#L409-L409) | 人工检查点 |
| 完成 | `◆` | `#` | 对接完成 |
| 阻塞 | `◇!` | `!` | 漂移阻塞 |
| 轨迹线 | `┊` | `|` | 次要轨道线 |
| 用户输入 | `>` | `>` | 指令 |
| 系统推断 | `∴` | `:` | 衍生状态 |

### 人工检查点语言 (Human Checkpoint Language)

权限提示应被框架化为 **人工检查点 (Human Checkpoint)** 状态。这使得暂停感觉是有意且受控的，而不是像通用的模态框。检查点必须显示：

- CSC 想要做什么
- 为什么需要权限
- 存在什么风险（如果有）
- 用户可以采取什么行动

## 页面架构

静态演示应位于：

```text
docs/design/csc-orbital-mesh-demo/
```

推荐文件：

- [index.html](file://d:\code\csc\packages\remote-control-server\web\index.html)
- `styles.css`
- `script.js`

页面必须在无需 Vite、构建工具或新依赖项的情况下正常工作。

### 首屏

首屏包含：

- 产品标题：`CSC Orbital Mesh`
- 专注于可控终端工作的简短价值主张
- 大型模拟终端窗口
- 五种场景的状态切换器
- 折叠下方场景网格的提示

终端预览是主要的可分享截图表面。

### 场景网格

在英雄区域下方，将所有五个状态显示为紧凑的终端预览。此部分通过在一个视图中使状态语言可比，支持内部审查。

### 设计系统摘要

最后一部分记录：

- 颜色令牌
- 信标符号和 ANSI 回退
- 布局规则
- 动效规则
- 未来 Ink 组件映射
- 非目标

## 场景规范

### 启动：启动对齐 (Boot Alignment)

目的：让启动感觉像是环境对齐，而不是嘈杂的日志记录。

所需信息：

- CSC 身份和版本
- 工作区路径
- 权限模式
- 带有短标签和持续时间的启动检查

示例检查：

- 配置已加载
- 项目索引已预热
- MCP 通道已检查
- 工具池已就绪

如果检查失败，显示一个可读的操作提示，而不是堆栈跟踪。
活动轨道状态为 `BOOT`，由 `◎` 表示。

### 空闲：待机轨道 (Standby Orbit)

目的：减少空屏不确定性，显示 CSC 已准备就绪。

所需信息：

- 安静的指令输入区域
- 当前模型
- 上下文预算摘要
- 项目状态摘要
- 紧凑的快捷键提示

输入占位符应使用命令语言措辞，例如：

```text
Inject instruction...
```

活动轨道状态为 [IDLE](file://d:\code\csc\src\components\LogoV2\AnimatedClawd.tsx#L37-L37)，由 `◌` 表示。视觉处理平静且低对比度轨道网格主要在背景中。

### 权限：人工检查点 (Human Checkpoint)

目的：使权限决策快速且易于理解。

所需信息：

- 请求的操作
- 工具名称
- 目标命令、文件、主机或路径
- 需要权限的原因
- 相关时的风险信号
- 可用操作

推荐操作：

- `Allow once` (允许一次)
- `Allow session` (允许会话期间)
- `Inspect` (检查)
- `Deny` (拒绝)

活动轨道状态为 `CHECKPOINT`，由 `◍` 表示。信标颜色切换为检查点黄色，以明确系统已暂停并等待用户。

### 完成：对接完成 (Docked Complete)

目的：确认结果并提供下一个有用的操作。

所需信息：

- 简洁的完成摘要
- 更改的文件数量
- 测试或验证状态
- 持续时间
- 推荐的下一步操作

推荐操作：

- `Review diff` (审查差异)
- `Run tests` (运行测试)
- `New task` (新任务)

活动轨道状态为 `COMPLETE`，由 `◆` 表示。使用薄荷绿作为对接信号，而不是全绿色的成功屏幕。

### 阻塞：漂移阻塞 (Drift Blocked)

目的：将失败转化为恢复路径。

所需信息：

- 具体的阻塞原因
- 最后成功的步骤
- 已尝试的操作
- 推荐的恢复路径

示例：

- `Blocked by missing token` (被缺失令牌阻塞)
- `Blocked by permission denial` (被权限拒绝阻塞)
- `Blocked by network timeout` (被网络超时阻塞)
- `Blocked by unresolved type error` (被未解决的类型错误阻塞)

活动轨道状态为 `BLOCKED`，由 `◇!` 表示。使用玫瑰色/洋红色作为边界和信标颜色，同时保持主要文本可读。

## 视觉令牌

所选的高对比度调色板故意不使用当前的橙色作为主色。

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `orbit-bg` | `#070713` | 页面和终端背景 |
| `orbit-panel` | `#10101D` | 主要终端面板 |
| `orbit-panel-raised` | `#17172A` | 凸起的终端表面 |
| `orbit-text` | `#D7C8FF` | 主要终端文本 |
| `orbit-muted` | `#8B82B8` | 次要终端文本 |
| `orbit-blue` | `#65D7FF` | 空闲、导航、次要焦点 |
| `checkpoint-yellow` | `#FFDF5D` | 权限和用户决策 |
| `dock-green` | `#6CF2B8` | 完成和安全继续 |
| `drift-rose` | `#FF5D8F` | 阻塞、拒绝、错误 |
| `orbit-line` | `rgba(215, 200, 255, 0.18)` | 分隔线和网格线 |

颜色使用必须保持语义化。除非内容确实具有多种状态，否则不要在单个小面板中同时使用所有强调色。

## 布局规则

在模拟终端内部，避免通用的卡片堆叠。使用三层终端容器结构：

1. 顶部轨道：身份、状态栏、工作区元数据
2. 事件流：特定状态的日志、摘要或检查点详情
3. 操作/输入坞：命令输入或决策操作

浏览器页面可以在预览周围使用卡片，但终端模拟本身应感觉像一个 cohesive 的仪表板。

## 动效规则

动效 intentionally 低成本：

- 每 2-3 秒缓慢扫描线
- 活动信标的微妙脉冲
- 切换场景时的短暂淡入淡出

不要使用 WebGL、canvas、重度粒子效果、图像依赖性或理解所需的动画。

Ink 实现稍后可以用现有的 spinner 和 timer 模式替换这些。

## 技术范围

### 范围内

- 一个静态浏览器演示页面
- 五个可切换的终端状态
- 五个状态缩略图或场景预览
- 在移动端不会破坏的响应式布局
- 无构建步骤
- 无新包依赖项
- 无 CLI 运行时行为更改

### 范围外

- 真实命令执行
- 实时项目状态读取
- 与 Ink 组件集成
- 主题选择器集成
- WebGL/canvas 效果
- 超出演示范围的产品营销网站
- 替换现有的 CLI 主题系统

## 未来 Ink 映射

如果此设计稍后在真实 CLI 中实现，它可以映射到四个小组件：

| 组件 | 职责 | 现有能力 |
| --- | --- | --- |
| `OrbitalStatusRail` | 显示当前工作流状态 | Ink [Text](file://d:\code\csc\packages\@ant\ink\src\components\Text.tsx#L107-L140), [Box](file://d:\code\csc\packages\@ant\ink\src\components\Box.tsx#L49-L115), 主题令牌 |
| `BeaconText` | 渲染状态符号和标签 | Ink [Text](file://d:\code\csc\packages\@ant\ink\src\components\Text.tsx#L107-L140) |
| `CheckpointPanel` | 权限检查点布局 | 现有权限对话框数据 |
| `OutcomeSummary` | 完成和阻塞摘要 | 现有消息/状态数据 |

这些组件应使用现有的主题基础设施和语义令牌。实现不需要为静态演示阶段改变 REPL 架构。

## 验收标准

1. 启动、空闲、权限、完成和阻塞状态都在同一演示页面上可见，并且主预览可以在它们之间切换。
2. 首屏清晰地展示了轨道网格记忆点：状态栏、信标符号和人工检查点语言。
3. 每个状态都回答了用户的实际问题：我在哪里，CSC 在做什么，我能做什么，接下来会发生什么。
4. 演示仅使用 HTML、CSS 和最少的 JavaScript。
5. 设计可以使用 [Text](file://d:\code\csc\packages\@ant\ink\src\components\Text.tsx#L107-L140)、[Box](file://d:\code\csc\packages\@ant\ink\src\components\Box.tsx#L49-L115)、主题令牌以及 spinner/timer 行为映射到 Ink。
6. 桌面截图具有足够的视觉冲击力用于外部分享。
7. 移动布局保持可读性 no overlapping or overflowing text。
8. 没有引入新的运行时依赖项或 CLI 行为更改。

## 非目标

- 不要制作通用的 AI 聊天界面。
- 不要直接复用现有的橙色主导视觉风格。
- 不要复制其他终端产品的视觉语言。
- 不要为了视觉戏剧性而牺牲权限清晰度。
- 不要引入需要复杂渲染引擎才能落地的设计。