# OOM 复现与排查方案

## 1. 问题摘要

现象来自 `bug/oom/log`：

- 长时间运行后退出时触发 OOM。
- 触发后终端卡死，需要关闭终端重开。
- V8 日志显示进程运行约 `13,477,350 ms`，约 3 小时 44 分钟。
- OOM 前堆使用接近 `3990 MB`，堆上限约 `4151 MB`。
- 终局错误为 `Reached heap limit Allocation failed - JavaScript heap out of memory`。

初步判断：

- 退出不是根因，更像最后触发器。
- 根因更可能是长会话期间 `messages`、`progress`、Ink/React 渲染树或相关缓存持续增长。
- 退出路径会执行 Ink unmount，可能需要遍历和释放巨大组件树，在堆已经接近上限时触发最后一次分配失败。

## 2. 核心假设

### H1：高频 progress 消息未被替换，持续 append

相关代码：

- `src/screens/REPL.tsx`：`onQueryEvent` 对 ephemeral progress 做 replace-in-place。
- `src/utils/sessionStorage.ts`：`isEphemeralToolProgress()` 定义哪些 progress 是 ephemeral。

风险点：

- `sleep_progress`、`bash_progress`、`powershell_progress`、`mcp_progress` 这类高频进度如果未被识别，会每秒或每 chunk 追加消息。
- 注释中已有明确历史信号：`13k+` messages、`120MB sleep_progress` transcript。
- 如果 progress 之间穿插了其他消息，反向扫描可能提前 `break`，导致旧 progress 没被替换。

### H2：fullscreen / transcript / virtual scroll 下保留过多消息树

相关代码：

- `src/components/Messages.tsx`
- `src/components/VirtualMessageList.tsx`
- `src/components/OffscreenFreeze.tsx`

风险点：

- `normalizeMessages()`、`applyGrouping()`、`buildMessageLookups()` 都随消息规模增长。
- Ink fiber tree 对每条消息有额外内存成本。
- full transcript 或 fullscreen 可能保留更多 scrollback。

### H3：退出路径是触发器

相关代码：

- `src/utils/gracefulShutdown.ts`

关键点：

- `cleanupTerminalModes()` 中会调用 `inst.unmount()`。
- unmount 会触发 React/Ink 组件树清理。
- 如果退出前 heap 已经接近上限，unmount 过程中的少量额外分配也足以触发 OOM。

## 3. 快速复现原则

不要等待 3-4 小时自然 OOM。复现时应降低堆上限，把问题压缩到几分钟内暴露。

### 3.1 Dev 模式低堆复现

PowerShell：

```powershell
$env:NODE_OPTIONS="--max-old-space-size=512 --trace-gc --heapsnapshot-near-heap-limit=3"
$env:CSC_OOM_PROBE="1"
bun run dev
```

如果 512MB 太快崩，改成：

```powershell
$env:NODE_OPTIONS="--max-old-space-size=1024 --trace-gc --heapsnapshot-near-heap-limit=3"
$env:CSC_OOM_PROBE="1"
bun run dev
```

### 3.2 构建产物低堆复现

```powershell
bun run build
$env:NODE_OPTIONS="--max-old-space-size=512 --trace-gc --heapsnapshot-near-heap-limit=3"
$env:CSC_OOM_PROBE="1"
node dist/cli.js
```

注意：

- `src/entrypoints/cli.tsx` 只在 `CLAUDE_CODE_REMOTE=true` 时自动追加 `--max-old-space-size=8192`。
- 本地复现时主动设置 `NODE_OPTIONS` 即可。

## 4. 推荐复现场景

复现脚本要尽量贴近真实用户行为，不要只跑人工构造的无限循环。目标是复现“用户长时间工作后退出时卡死/OOM”的体验，同时让 probe 能指出是哪类消息在增长。

### 场景 A：半天连续编码会话后退出

用户画像：

- 用户在同一个 CLI 会话里连续处理一个真实代码任务。
- 中途多次让模型读文件、改文件、运行测试、修复失败。
- 最后通过 `/exit` 或 Ctrl+C 退出。

操作剧本：

1. 用低堆上限启动，开启 `CSC_OOM_PROBE=1`。
2. 选择一个中等规模任务，例如“修复某个测试失败并补测试”。
3. 让模型完成 5-10 轮真实交互：读代码、改代码、跑单测、根据失败继续修。
4. 中途不要 `/clear`，保留同一个会话历史。
5. heap 明显上涨后执行一次 `/heapdump`。
6. 最后执行 `/exit`，观察是否退出阶段 OOM 或终端卡住。

观测重点：

- `messages.length` 是否随轮次持续增长但没有 compact 后回落。
- `progressTypes` 是否被某一类 progress 主导。
- 退出前 heap 是否已经接近低堆上限。

判定：

- 如果退出前 heap 已经很高，退出只是触发器。
- 如果退出前 heap 不高但 `/exit` 后突然暴涨，重点查退出清理和 Ink unmount。

### 场景 B：用户让模型“等测试/服务跑完”

用户画像：

- 用户启动一个耗时命令后，让模型等待结果。
- 常见说法是“等它跑完再看结果”“监控一下这个服务”“测试跑完告诉我”。

操作剧本：

1. 让模型启动一个真实耗时任务，例如构建、测试、dev server、日志监听。
2. 用户输入类似：

```text
等测试跑完，如果失败就继续修。
```

或：

```text
帮我看着这个服务，等它启动成功后继续。
```

3. 保持会话 10-30 分钟。
4. 期间不要手动清空历史。
5. 观察 probe，再执行 `/heapdump` 和 `/exit`。

观测重点：

- `bash_progress`、`powershell_progress`、`mcp_progress` 是否持续增长。
- 工具输出是否以大字符串形式留在 `messages` 中。
- transcript 文件是否随等待时间快速膨胀。

判定：

- 如果 shell progress 按秒增长，说明前台长任务的进度更新没有稳定替换。
- 如果 progress 稳定但 heap 增长，检查命令输出、日志内容或 tool result 是否被持续保留。

### 场景 C：用户开启自动/定时工作后长时间离开

用户画像：

- 用户让模型进入自动工作、定时检查、继续推进任务的状态。
- 用户离开电脑一段时间后回来退出。

操作剧本：

1. 启动支持自动工作相关功能的构建。
2. 用户输入类似：

```text
接下来你自己继续推进，没事就等一会儿再检查。
```

或：

```text
我先离开，你定期检查测试结果，有问题就修。
```

3. 保持空闲 30-60 分钟，低堆复现时可缩短到 10-15 分钟。
4. 回来后先执行 `/heapdump`。
5. 再执行 `/exit`。

观测重点：

- `sleep_progress` 是否持续增长。
- 是否存在 tick / scheduled / automation 相关消息持续进入主 `messages`。
- auto compact 是否发生，发生后 `messages.length` 是否回落。

判定：

- 如果 `sleep_progress` 或自动 tick 相关消息持续增长，优先查 H1。
- 如果 compact 后仍保留大量历史，优先查 fullscreen scrollback 或 QueryEngine mutableMessages。

### 场景 D：用户频繁查看历史和长输出

用户画像：

- 用户在长会话中经常打开 transcript/fullscreen 查看历史。
- 会话里有大段测试输出、diff、日志、agent 输出。

操作剧本：

1. 进行一个会产生较多输出的真实任务，例如大范围测试修复。
2. 多次进入 transcript/fullscreen 历史视图。
3. 向上滚动查看旧消息，再回到底部继续工作。
4. 重复 5-10 次。
5. 执行 `/heapdump`，再 `/exit`。

观测重点：

- `messages.length` 稳定时，`normalizedMessages`、`collapsed`、`renderableMessages` 是否仍变大。
- React/Ink snapshot 中是否出现大量 `MessageRow`、`FiberNode`、`OffscreenFreeze`。
- virtual scroll 是否限制了实际 mounted 的消息数量。

判定：

- 如果原始 messages 不涨但 UI 对象涨，重点查 Messages/VirtualMessageList/OffscreenFreeze。
- 如果进入/退出 transcript 后 heap 不回落，查 UI cache 或 React subtree 保留。

### 场景 E：多 agent 协作任务

用户画像：

- 用户让多个 agent 分工，例如一个读代码、一个写测试、一个修 bug。
- 主会话持续显示各 agent 的进度。

操作剧本：

1. 用户输入类似：

```text
请并行分析这个问题：一个 agent 看前端，一个看后端，一个跑测试，最后汇总。
```

2. 让 agent 运行足够久，期间不要提前中断。
3. 多次查看 agent 详情或任务输出。
4. 汇总完成后继续追问 2-3 轮。
5. 执行 `/heapdump` 和 `/exit`。

观测重点：

- `agent_progress`、`skill_progress` 是否持续增长。
- agent 详情 UI 是否保留完整子会话 transcript。
- 主会话和 sidechain transcript 是否重复保留同一批消息。

判定：

- `agent_progress` 不应简单替换，但必须确认它是否有合理上限、折叠或摘要。
- 如果 agent 完成后 progress 历史仍长期占用主会话 heap，需要设计清理或压缩策略。

### 场景 F：退出方式对照

用户画像：

- 用户可能通过 `/exit`、Ctrl+C、关闭终端窗口等方式退出。
- 原始现象是退出时卡死，必须关闭终端。

操作剧本：

1. 用同一个高内存场景分别测试三种退出方式：
   - `/exit`
   - Ctrl+C
   - 直接关闭终端窗口
2. 每次退出前先记录 probe 最新一行。
3. 每次退出前尽量执行 `/heapdump`。

观测重点：

- 哪种退出方式最稳定触发 OOM。
- 是否只有会触发 graceful shutdown 的路径才卡死。
- 退出前后是否打印 resume hint。

判定：

- `/exit` 和 Ctrl+C 都 OOM：优先查 gracefulShutdown / Ink unmount。
- 直接关闭终端也 OOM：可能是 SIGHUP/orphan cleanup 或终端 I/O 相关。
- 只有退出前高 heap 的会话 OOM：仍以长会话增长为主因。

## 5. 必加观测点

建议加一个环境变量开关，不要默认输出。

环境变量：

```powershell
$env:CSC_OOM_PROBE="1"
```

### 5.1 REPL 消息计数探针

插入位置：

- `src/screens/REPL.tsx`
- `onQueryEvent` 中 `setMessages` 后或集中封装的 `setMessages` wrapper 中。

需要记录：

```text
heapUsed
rss
messages.length
progressCount
progressTypes
lastMessageType
lastProgressType
screen
isLoading
```

伪代码：

```text
if CSC_OOM_PROBE enabled and now - lastLog > 10s:
  count all messages by type
  count progress messages by data.type
  log heap/rss/message/progress summary
```

输出示例：

```text
[oom-probe] heap=412MB rss=730MB messages=1820 progress=1210 types={sleep_progress:1188,bash_progress:22}
```

### 5.2 progress replace 命中率探针

插入位置：

- `src/screens/REPL.tsx`
- `isEphemeralToolProgress(...)` 分支内。

需要记录：

```text
progressType
parentToolUseID
replaced=true/false
scanStoppedBy
oldMessages.length
```

伪代码：

```text
for old messages backward:
  if found same parent/type:
    replaced = true
  if stopped because non-progress:
    scanStoppedBy = message.type
if not replaced:
  log append of ephemeral progress
```

判定：

- 如果同一个 `parentToolUseID + progressType` 反复 `replaced=false`，说明 replace 策略有缺陷。
- 常见原因是 progress 中间穿插了非 progress 消息，当前扫描遇到非 progress 后提前停止。

### 5.3 Messages 渲染规模探针

插入位置：

- `src/components/Messages.tsx`

需要记录：

```text
messages.length
normalizedMessages.length
messagesToShow.length
collapsed.length
lookups.progressMessagesByToolUseID.size
renderableMessages.length
```

目的：

- 判断是原始消息数组增长，还是 normalize/group/lookups 造成放大。
- 判断 virtual scroll 是否真的限制了 mounted/renderable 数量。

### 5.4 sessionStorage 写入探针

插入位置：

- `src/utils/sessionStorage.ts`
- `recordTranscript()`
- `cleanMessagesForLogging()`

需要记录：

```text
input messages count
cleaned messages count
newMessages count
progress skipped or persisted count
session messageSet size
```

目的：

- 排除 transcript 记录逻辑反复全量扫描或错误持久化 progress。
- 如果 transcript 文件持续增长到几十 MB，优先看这里。

## 6. heapdump 使用方式

仓库已有 `/heapdump` 命令。

建议抓三次：

1. baseline：启动后空闲 1 分钟。
2. growing：heap 持续上涨但未接近上限时。
3. pre-exit：退出前，heap 达到低堆上限的 70%-85% 时。

不要等接近 OOM 再抓。heap snapshot 本身会分配大量内存，可能直接把进程打爆。

输出位置：

- 桌面目录
- 文件包括 `.heapsnapshot` 和 `-diagnostics.json`

优先看 diagnostics：

```text
memoryUsage.heapUsed
memoryUsage.rss
v8HeapStats.heapSizeLimit
v8HeapStats.detachedContexts
activeHandles
activeRequests
memoryGrowthRate.mbPerHour
```

判断：

- `heapUsed` 高：JS 对象保留，重点看 messages / React / Maps。
- `rss` 高但 `heapUsed` 不高：可能是 native memory、Bun、终端渲染 buffer、addon。
- `activeHandles` 高：可能有 timer/socket/file handle 泄漏。

## 7. heap snapshot 分析重点

用 Chrome DevTools 打开 `.heapsnapshot`。

优先搜索：

```text
ProgressMessage
NormalizedMessage
MessageRow
RenderableMessage
Map
Array
FiberNode
OffscreenFreeze
StreamingMarkdown
```

重点看：

- Retained Size 最大的对象。
- 谁持有最大 `Array`。
- 是否存在大量相同 `data.type = sleep_progress` 的对象。
- 是否存在大量 React FiberNode 指向旧 MessageRow。
- `Map` 是否由 `progressMessagesByToolUseID` 或 lookups cache 持有。

对比 baseline 和 growing：

- 如果 `ProgressMessage` 数量增幅接近 `messages.length` 增幅，优先修 H1。
- 如果 React FiberNode 增长远大于消息数，优先查 Ink/virtual scroll/mount 缓存。
- 如果大字符串占主导，优先查工具输出、transcript、bash stdout/stderr 保留。

## 8. GC 日志判读

启动参数：

```powershell
$env:NODE_OPTIONS="--max-old-space-size=512 --trace-gc"
```

重点观察：

```text
Scavenge ... A -> B MB
Mark-Compact ... A -> B MB
average mu
current mu
```

判断：

- GC 后 `B` 持续升高：对象被强引用，是真泄漏或无上限缓存。
- GC 后 `B` 能回落但 RSS 不回落：可能是 native/Bun/allocator 行为，不一定是 JS 泄漏。
- 频繁 Scavenge 但无 Mark-Compact：新生代分配压力大，可能是 render/normalize 高频分配。
- Mark-Compact 后仍接近上限：老生代对象被保留。

## 9. 推荐排查顺序

1. 低堆上限复现，确认几分钟内可触发。
2. 加 `CSC_OOM_PROBE`，确认 `messages.length` 是否持续增长。
3. 按 `data.type` 拆分 progress，找增长最快的类型。
4. 如果 progress 增长，检查 `isEphemeralToolProgress()` 是否覆盖该类型。
5. 如果类型已覆盖，检查 replace 是否因为 interleaving 失败。
6. 如果 messages 不增长，检查 `Messages.tsx` 的 normalized/collapsed/lookups/renderable 是否放大。
7. 如果 JS heap 不高但 RSS 高，转查 native memory / active handles / terminal buffer。
8. 最后验证退出路径：退出前抓 heapdump，退出时观察是否只是触发 OOM。

## 10. 判定矩阵

| 观测结果 | 结论 | 下一步 |
| --- | --- | --- |
| `messages.length` 线性增长 | 消息保留或 append 失控 | 按 type/progressType 拆分 |
| `sleep_progress` 线性增长 | Sleep progress replace 失效 | 查 feature gate 和 replace 扫描 |
| `bash_progress`/`powershell_progress` 线性增长 | shell progress replace 失效 | 查 parentToolUseID 和 interleaving |
| `agent_progress` 线性增长 | agent 历史无上限 | 设计摘要/上限/折叠 |
| `messages.length` 稳定但 `normalized/collapsed` 增长 | UI transform 放大 | 查 normalize/group/lookups |
| JS heap 高，RSS 同步高 | JS 对象泄漏 | 看 heap snapshot retained size |
| JS heap 低，RSS 高 | native/allocator/终端 buffer | 看 diagnostics 和 active handles |
| 退出前已高，退出时 OOM | 退出是触发器 | 修长会话增长 |
| 退出前低，退出瞬间暴涨 | 退出清理路径问题 | 查 gracefulShutdown / hooks / unmount |

## 11. 可能修复方向

### 11.1 修复 ephemeral progress 识别

如果发现某类高频 progress 未在 `EPHEMERAL_PROGRESS_TYPES` 中：

```text
把该 progress type 加入 ephemeral 集合
确保该类型不需要历史 UI
加单测覆盖 replace-in-place
```

### 11.2 修复 interleaving 导致 replace 失败

当前逻辑遇到非 progress 会停止扫描。若真实消息流中 progress 会被其他消息穿插，应改为有限窗口扫描：

```text
向后最多扫描 N 条消息
跳过无关非 progress
找到同 parentToolUseID + same type 则替换
未找到才 append
```

需要避免全量倒扫造成 O(n) 卡顿。

### 11.3 给 progress 加硬上限

即使某些 progress 需要历史，也应有安全上限：

```text
每个 parentToolUseID 最多保留 N 条 progress
超过后压缩成 summary
保留首条、最近 M 条、关键状态变更
```

### 11.4 给全局 messages 加防爆保护

极端情况下，UI 不应无限保留所有消息：

```text
非 transcript 模式保留最近 N 条
fullscreen scrollback 保留最近 N 条或 compact boundary 后消息
超限时插入 snipped system message
```

### 11.5 退出路径降风险

如果确认退出 unmount 是触发器，可考虑：

```text
shutdownInProgress 时跳过重渲染重计算
退出前先 detach terminal，再最小化 unmount 工作
对超大消息树走 fast shutdown path
```

但这只能缓解退出卡死，不能解决长会话内存持续增长。

## 12. 最小完成标准

修复前必须能稳定复现：

- 低堆上限下 5-15 分钟内复现 heap 持续增长或 OOM。
- probe 能指出主要增长类型。

修复后必须验证：

- 同一复现场景运行至少 2 倍原复现时间。
- `messages.length` 不再随高频 progress 线性增长。
- `progressTypes` 中高频类型保持常数或有明确上限。
- `/heapdump` diagnostics 中 `heapUsed` 增长率显著下降。
- `/exit` 不再在高内存状态下卡死或 OOM。

## 13. 建议保留的证据

每次复现保存：

```text
启动命令
NODE_OPTIONS
启用的 feature flags
是否 fullscreen/transcript
触发场景
运行时长
退出方式
probe 日志
GC 日志
heap diagnostics json
heap snapshot 文件名
transcript 文件大小
```

建议保存到：

```text
bug/oom/runs/<日期>-<场景>/
```

不要把大型 `.heapsnapshot` 直接提交到仓库，除非明确需要归档。
