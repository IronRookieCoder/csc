# 分层诊断指南

本文档是 Phase 2 的核心引擎，定义每层的结构化检查清单、假设验证方法和进入/退出条件。

## 分层总览

| Layer | 名称 | 检查项数 | 典型耗时 | 优先级 |
|-------|------|---------|---------|--------|
| 1 | JSONL 会话记录 | 12 | 1-3min | ★★★★★ |
| 2 | 进程级调试 (--debug) | 5 | 2-5min | ★★★★★ |
| 2.5 | 内置诊断命令 | 7 | 1-2min | ★★★★★ |
| 3 | MCP 专项 | 6 | 3-10min | ★★★★ |
| 4 | Hooks 专项 | 6 | 3-10min | ★★★★ |
| 5 | API/服务端 | 8 | 5-15min | ★★★ |
| 6 | 代理/CA/企业网络 | 6 | 10-30min | ★★★ |
| 7 | mitmproxy 抓包 | 4 | 15-45min | ★★ |
| 8 | Wireshark/tcpdump | 3 | 30-60min | ★ |
| 9 | OpenTelemetry | 4 | 15-30min | ★ |
| 10 | 隔离环境验证 | 3 | 不定 | ★ |

## 诊断规则

1. **逐层递进**：从起始层开始，不可跳层
2. **单假设验证**：每层每次只验证一个假设
3. **证据标注**：每个结论必须标注证据来源（JSONL 行号、debug log 片段、配置文件路径）
4. **层间回退**：当证据指向更高层问题时，可回退
5. **层间前进**：本层所有检查正常 → 进入下一层
6. **连续无发现**：连续 3 层无异常 → 提醒确认方向

---

## Layer 1: JSONL 会话记录

### 所需数据
- 故障会话的 JSONL 文件（用户指定的路径或 bundle 中的 `session/transcript-sanitized.jsonl`）
- 如果 bundle 中有 `summary/timeline.md`，先读取了解时间线

### 层概述
JSONL 是信息金矿。几乎所有异常——API 错误、工具调用失败、MCP 异常、权限拒绝——都会在 JSONL 中留下可追踪的痕迹。**这是大多数故障的最佳起始层。**

### 检查清单

#### Check 1.1: 查找错误消息
- **操作**：搜索 JSONL 中包含 error/fail/exception/denied/timeout/refused 关键字的行
- **正常现象**：无此类消息，或仅偶发的可恢复错误
- **异常现象**：存在错误消息 → 提取完整错误上下文和周围的 message 行
- **证据提取**：记录出错的 message UUID、timestamp、sessionId

#### Check 1.2: 最后 N 轮工具调用状态
- **操作**：从 JSONL 末尾向前查找最近 5 轮 tool_use → tool_result 配对
- **正常现象**：每个 tool_use 都有对应的 tool_result
- **异常现象**：
  - tool_use 存在但 tool_result 缺失 → 工具调用卡住了
  - tool_result 中有 is_error: true → 工具调用执行失败
  - tool_result 中 exitCode 非零 → Bash 命令执行失败

#### Check 1.3: Token 消耗趋势
- **操作**：提取 JSONL 中每条 assistant message 的 `usage.input_tokens` 和 `usage.output_tokens`
- **正常现象**：token 消耗平稳或有规律的增长
- **异常现象**：
  - 某条消息 token 突然暴涨 → 可能有超大文件读取或大量工具结果
  - 接近 context window 上限时 token 被截断
  - output_tokens 异常少（可能是模型拒绝回复）

#### Check 1.4: Subagent 完成状态
- **操作**：检查 `subagents/` 目录下的 agent JSONL 文件
- **正常现象**：所有 subagent 的 JSONL 有明确的结束标记
- **异常现象**：subagent 的 JSONL 在 tool_use 处截断 → subagent 卡死或超时

#### Check 1.5: Write/Edit 操作序列
- **操作**：提取所有 Write 和 Edit 的 tool_use 记录
- **正常现象**：操作序列逻辑合理，文件修改可追踪
- **异常现象**：
  - 同一个文件被短时间内反复修改 → 可能死循环
  - Edit 操作的 old_string 找不到匹配 → 文件内容已被修改

#### Check 1.6: MCP tool_use → tool_result 配对
- **操作**：过滤出 MCP 相关工具的调用（tool_use 的 name 来自 MCP server）
- **正常现象**：每个 MCP tool_use 都在合理时间内有 tool_result
- **异常现象**：
  - 没有 MCP tool_use 记录 → 可能 MCP 未加载或 tools=0
  - tool_use 存在但无 tool_result → MCP server 崩溃或无响应

#### Check 1.7: 上下文大小变化
- **操作**：检查 JSONL 中不同阶段的消息数量变化
- **正常现象**：上下文随对话推进逐渐增长
- **异常现象**：
  - 上下文突然大幅缩小 → 可能触发了 /compact
  - 某条消息后上下文爆炸 → 该工具调用返回了大量数据

#### Check 1.8: 消息完整性
- **操作**：检查 JSONL 最后几条消息是否完整
- **正常现象**：每条消息都是完整 JSON 对象，最后一条消息有明确 type
- **异常现象**：
  - 最后一行 JSON 不完整 → JSONL 写入过程中进程崩溃
  - 最后类型是 tool_use 但没有 tool_result → 进程在工具执行期间终止

#### Check 1.9: stop_reason 与 tool_use 内容块一致性
- **操作**：提取每条 assistant message 的 `stop_reason` 和 `content` 中的 tool_use 块，对比是否一致
- **正常现象**：`stop_reason=tool_use` 时 content 中必有至少一个 tool_use 块；`stop_reason=end_turn` 时 content 中通常无 tool_use 块
- **异常现象**：
  - `stop_reason=tool_use` 但 content 仅含 text 块 → **模型畸形响应**（多见于 API 兼容层：OpenAI/Gemini/Grok 协议转换时丢失 tool_use 数据）
  - 连续两轮出现此现象 + 后续出现 `isApiErrorMessage: true` → 确认是模型侧或兼容层问题
- **证据提取**：记录畸形的 message UUID、模型名称、API provider（从 debug log 或 API 快照确认）

#### Check 1.10: isApiErrorMessage 标记检测
- **操作**：搜索 JSONL 中包含 `"isApiErrorMessage": true` 的 message
- **正常现象**：不存在此类消息
- **异常现象**：
  - 存在 `isApiErrorMessage: true` → 框架层面检测到了 API 异常并注入了错误消息
  - **务必向上追溯**：找到该 API 错误消息之前的 2-3 轮 assistant message，分析其 `stop_reason` 和 content，通常是前序畸形响应触发了此保护机制
- **证据提取**：记录 API 错误消息的完整 text、前序 assistant message 的 stop_reason 和 content 结构

#### Check 1.11: 失败案例 vs 成功案例对比（如有对照数据）
- **操作**：当有同场景下的成功案例 JSONL 时，与失败案例进行逐轮对比
- **对比维度**：
  - 使用的工具名称（失败用 TaskCreate vs 成功用 update_todo_list?）
  - stop_reason 和 content 结构差异
  - 模型名称和 provider 是否不同
  - 错误发生前一轮的 message 结构差异
- **正常现象**：对比能揭示失败案例的独特特征（如使用的工具不同、模型不同、API 路径不同）
- **异常现象**：失败和成功在相同条件下表现不同 → 大概率是概率性模型问题或时序敏感问题
- **证据提取**：记录失败/成功的对比表格，标注差异点

#### Check 1.12: 其他工具/平台的同一场景表现（跨工具对比）
- **操作**：如有 CoStrict、Claude Code 官方版等同场景数据（如 `costrict/*.json`），对比其工具使用模式
- **对比维度**：
  - 使用了哪些工具来完成任务
  - 工具的调用参数结构
  - 是否成功完成
- **目的**：判断问题是 CSC 特有问题还是通用模型问题，以及问题是否与特定工具（如 TaskCreate vs update_todo_list）绑定

### 常见假设（按可能性排序）
1. 工具调用返回了错误（is_error: true 或非零 exit code）— 可能性：高
2. 模型畸形响应：`stop_reason=tool_use` 但 content 无 tool_use 块（API 兼容层问题）— 可能性：中
3. 某工具调用卡住未返回结果 — 可能性：中
4. API 请求返回了错误状态码 — 可能性：中
5. 上下文过大导致行为异常 — 可能性：中
6. MCP server 连接断开 — 可能性：低

### 进入/退出条件
- **进入**：总是可以进入（成本最低）
- **退出 → 下一层**：本层无异常发现，或异常需要更底层确认（如 API 响应格式需要 Layer 2 debug log 或 API 快照验证）
- **退出 → RCA_FOUND**：在 JSONL 中直接定位到根因（如明确的错误消息 + 非零 exit code + 工具调用失败，或畸形响应 + isApiErrorMessage 形成完整证据链）

---

## Layer 2: 进程级调试 (--debug)

### 所需数据
- debug log 文件（`~/.claude/debug/<sessionId>.txt` 或 bundle 的 `errors/` 目录）
- 如果还没有 debug log，本层需要开启 `--debug` 重现问题

### 层概述
--debug 输出提供运行时级别的信息，包括 API 请求/响应细节、MCP server 启动过程、Hook 执行日志。对于只靠 JSONL 无法确定的运行时问题，本层是关键。

### 检查清单

#### Check 2.1: ERROR/FATAL 级别日志
- **操作**：过滤 debug log 中 level 为 error 或 fatal 的行
- **正常现象**：无此类日志
- **异常现象**：
  - ERROR: 通常对应可恢复问题（如重试成功）
  - FATAL: 通常对应不可恢复问题（如进程退出）
- **证据提取**：记录出错时间和完整日志行

#### Check 2.2: API 分类 — request/response status
- **操作**：过滤 debug log 中 api 分类的 entry，查看 HTTP status code
- **正常现象**：200，偶尔有 4xx/5xx 但重试后成功
- **异常现象**：
  - 401 → API key 问题
  - 429 → 限流
  - 500/503/529 → 服务端错误
  - 持续的超时 → 网络或代理问题

#### Check 2.3: MCP 分类 — server 启动和工具列表
- **操作**：过滤 debug log 中 mcp 分类的 entry
- **正常现象**：server 启动成功，tools/list 返回 N 个工具
- **异常现象**：
  - server spawn 失败 → command/path 错误
  - tools/list 返回空 → server 实现问题
  - tools/list 超时 → server 性能问题

#### Check 2.4: Hooks 分类 — matcher 评估和 hook 执行
- **操作**：过滤 debug log 中 hooks 分类的 entry
- **正常现象**：matcher 被正确评估，匹配到的 hook 正常执行
- **异常现象**：
  - matcher 评估了但未匹配 → matcher 写错
  - hook 执行后非零 exit code → hook script 有问题
  - stdout 解析失败 → hook 输出格式错误

#### Check 2.5: 进程退出信号
- **操作**：查看 debug log 尾部是否有进程退出相关日志
- **正常现象**：进程正常关闭有 "shutdown" "cleanup" 等日志
- **异常现象**：
  - 日志突然截断 → 进程被 kill 或 crash
  - "uncaughtException" 或 "unhandledRejection" → 代码 bug

### 常见假设（按可能性排序）
1. API 返回了非 200 状态码 — 可能性：高
2. MCP server 启动命令错误 — 可能性：中
3. Hook 的 stdout/stderr/exit code 有误 — 可能性：中

### 进入/退出条件
- **进入**：Layer 1 无法确定根因时
- **退出 → 下一层**：debug log 无异常，或异常需要专项排查
- **退出 → RCA_FOUND**：debug log 中明确显示错误码/失败原因

---

## Layer 2.5: 内置诊断命令

### 所需数据
- 可在 CSC 内直接运行的 slash commands
- 如果无法启动 CSC，本层跳过

### 层概述
CSC 内置的诊断命令提供一键式健康检查，不需要手动分析日志。在 CSC 可正常启动时，这是最快的信息获取方式。

### 检查清单

#### Check 2.5.1: /doctor
- **操作**：运行 /doctor
- **正常现象**：无 error/warning，安装状态正常
- **异常现象**：
  - 安装类型异常 → 检查安装方式
  - 配置 mismatch → 检查 settings
  - ripgrep 不可用 → 影响搜索工具

#### Check 2.5.2: /status
- **操作**：运行 /status
- **正常现象**：各项配置有明确的 source 标注
- **异常现象**：
  - 某配置项未按预期加载 → 检查 source 优先级
  - 预期来自 localSettings 的配置实际来自 userSettings → 文件路径或覆盖问题

#### Check 2.5.3: /context
- **操作**：运行 /context
- **正常现象**：各类 token 占用分布合理
- **异常现象**：
  - CLAUDE.md 占用过大 → 精简
  - MCP tools 占用过大 → 减少 tools
  - Agent descriptions 占用过大 → 精简 agent 描述

#### Check 2.5.4: /mcp
- **操作**：运行 /mcp
- **正常现象**：所有 server connected，tools > 0
- **异常现象**：server failed / connected but 0 tools / not approved

#### Check 2.5.5: /hooks
- **操作**：运行 /hooks
- **正常现象**：预期 hook 在列表中，matcher 正确
- **异常现象**：hook 缺失或 matcher 不对

#### Check 2.5.6: /permissions
- **操作**：运行 /permissions
- **正常现象**：权限规则按预期排列
- **异常现象**：
  - allow 规则被 deny 覆盖 → 检查规则优先级
  - 某规则 unreachable → 被更宽的规则 shadow

#### Check 2.5.7: /debug
- **操作**：运行 /debug（在 CSC 内开启 debug 模式）
- **正常现象**：debug 模式正常开启
- **异常现象**：开启失败 → 检查权限或 debug 目录写入权限

### 进入/退出条件
- **进入**：CSC 可正常启动时（大多数故障场景）
- **退出 → 下一层**：内置命令未发现明确异常
- **退出 → RCA_FOUND**：/doctor 或 /status 直接定位到配置/安装问题

---

## Layer 3: MCP 专项调试

### 所需数据
- /mcp 输出
- debug log (mcp 分类)
- .mcp.json 文件
- MCP server 自身的日志

### 检查清单

#### Check 3.1: MCP server 是否在列表中
- **操作**：/mcp 或 `claude mcp list`
- **正常现象**：预期的 server 出现在列表中
- **异常现象**：server 不在列表中 → .mcp.json 位置不正确或未被加载

#### Check 3.2: Tools 数量
- **操作**：/mcp 查看每个 server 的 tools 数量
- **正常现象**：tools > 0
- **异常现象**：tools = 0 → server 启动了但未返回工具列表

#### Check 3.3: .mcp.json 路径和格式
- **操作**：检查项目根目录的 .mcp.json 文件
- **正常现象**：JSON 格式正确，路径为绝对路径或可解析的相对路径
- **异常现象**：JSON 语法错误 / command 路径不存在 / args 格式错误

#### Check 3.4: Command 执行记录
- **操作**：debug log 中 mcp 分类查看 server spawn 命令和结果
- **正常现象**：spawn 成功，stdout/stderr 无异常
- **异常现象**：spawn 失败有明确错误信息

#### Check 3.5: Approval 状态
- **操作**：/mcp 检查 approval 状态
- **正常现象**：已 approve
- **异常现象**：pending approval → 工具不可用

#### Check 3.6: 环境变量传递
- **操作**：检查 .mcp.json 中的 env 段
- **正常现象**：环境变量正确传递给 MCP server
- **异常现象**：env 放错位置或变量名拼写错误

### 进入/退出条件
- **进入**：Layer 2.5 的 /mcp 发现异常，或症状直接指向 MCP
- **退出 → 下一层**：MCP 配置和运行正常
- **退出 → RCA_FOUND**：MCP server 配置错误或运行失败

---

## Layer 4: Hooks 专项调试

### 所需数据
- /hooks 输出
- debug log (hooks 分类)
- settings.json 中 hooks 段

### 检查清单

#### Check 4.1: Hook 是否被加载
- **操作**：/hooks 查看 hook 列表
- **正常现象**：预期 hook 在列表中
- **异常现象**：hook 不在列表中 → 检查 settings 的 source

#### Check 4.2: Matcher 是否匹配
- **操作**：debug log (hooks 分类) 查看 matcher 评估过程
- **正常现象**：触发对应操作时 matcher 评估结果为 true
- **异常现象**：matcher 返回 false → 字符串不匹配（注意大小写）

#### Check 4.3: Command 是否可执行
- **操作**：手动在终端执行 hook command
- **正常现象**：命令正常执行无报错
- **异常现象**：权限不足 / 路径不存在 / 依赖缺失

#### Check 4.4: stdout/stderr 输出
- **操作**：debug log 查看 hook 执行的 stdout 和 stderr
- **正常现象**：stdout 是有效 JSON，stderr 无 FATAL 错误
- **异常现象**：stdout 包含非 JSON 内容（污染） / stderr 有 FATAL

#### Check 4.5: Exit code
- **操作**：debug log 查看 exit code
- **正常现象**：0（允许）或 2（阻止）
- **异常现象**：其他非零值 → hook 执行失败

#### Check 4.6: 多层 settings 覆盖冲突
- **操作**：/status 查看 hooks 配置来自哪个 source
- **正常现象**：hooks 配置来自预期的 settings 文件
- **异常现象**：多个 source 都有 hooks 配置，覆盖关系混乱

### 进入/退出条件
- **进入**：Layer 2.5 的 /hooks 发现异常，或症状直接指向 hooks
- **退出 → 下一层**：hooks 配置和执行正常
- **退出 → RCA_FOUND**：hook 配置错误或执行失败

---

## Layer 5: API/服务端调试

### 所需数据
- debug log (api 分类)
- curl 命令
- claude auth status 输出

### 检查清单

#### Check 5.1: 认证状态
- **操作**：`claude auth status --text`
- **正常现象**：已认证，token 有效
- **异常现象**：未认证 / token 过期

#### Check 5.2: API 端点连通性
- **操作**：`curl -I https://api.anthropic.com`（或对应的 provider 端点）
- **正常现象**：返回 HTTP 响应（即使 401 也说明连通）
- **异常现象**：连接超时 / 拒绝连接

#### Check 5.3: HTTP Status Code 模式
- **操作**：debug log 统计 status code 分布
- **正常现象**：主要为 200
- **异常现象**：
  - 401 → 认证问题
  - 429 → 限流
  - 500/503/529 → 服务端错误
  - 持续 timeout → 网络/代理问题

#### Check 5.4: Retry 行为
- **操作**：debug log 中查找 retry 相关日志
- **正常现象**：偶有重试，重试后成功
- **异常现象**：持续重试且全部失败 → 非临时性错误

#### Check 5.5: API Key 有效性
- **操作**：通过 curl 带上 API key 发送一个简单的 messages 请求
- **正常现象**：返回 200 且有正常回复
- **异常现象**：401 → key 无效；403 → 权限不足

#### Check 5.6: 环境变量影响
- **操作**：检查 `CLAUDE_CODE_MAX_RETRIES`、`API_TIMEOUT_MS`
- **正常现象**：使用默认值即可正常工作
- **异常现象**：过小的 retry 或 timeout 导致过早放弃

#### Check 5.7: SSL 证书
- **操作**：curl API 端点，检查是否有 SSL 错误
- **正常现象**：TLS 握手正常
- **异常现象**：`SSL certificate problem` → Layer 6

#### Check 5.8: Request 大小
- **操作**：debug log 查看 request body 大小
- **正常现象**：在模型限制内
- **异常现象**：request 过大 → "prompt too long"

### 进入/退出条件
- **进入**：Layer 2 发现 API 相关问题
- **退出 → 下一层**：API 层正常，问题指向网络层
- **退出 → RCA_FOUND**：401/429/5xx 等明确的服务端/认证问题

---

## Layer 6: 代理/CA/企业网络

### 检查清单

#### Check 6.1: 代理环境变量
- **操作**：检查 `echo $HTTP_PROXY` `echo $HTTPS_PROXY` `echo $NO_PROXY`
- **正常现象**：设置正确或不设置
- **异常现象**：代理地址错误 / NO_PROXY 排除了 API 域名

#### Check 6.2: CA 证书
- **操作**：检查 `echo $NODE_EXTRA_CA_CERTS` 和 `echo $CLAUDE_CODE_CERT_STORE`
- **正常现象**：未设置或指向有效证书
- **异常现象**：证书路径不存在 / 证书无效

#### Check 6.3: 通过代理测试连通性
- **操作**：`curl -x $HTTPS_PROXY https://api.anthropic.com`
- **正常现象**：通过代理可连通
- **异常现象**：代理连接失败

#### Check 6.4: 企业防火墙白名单
- **操作**：依次 curl 测试关键域名
- **正常现象**：所有域名可达
- **异常现象**：部分域名不可达 → 需 IT 配置白名单

#### Check 6.5: DNS 解析
- **操作**：`nslookup api.anthropic.com`
- **正常现象**：正常解析
- **异常现象**：解析失败 → DNS 问题

#### Check 6.6: 反向代理/自签证书
- **操作**：检查是否有企业 TLS inspection
- **正常现象**：证书链受信任
- **异常现象**：证书链中有企业自签 CA → 需要 NODE_EXTRA_CA_CERTS

### 进入/退出条件
- **进入**：Layer 5 发现网络层问题
- **退出 → 下一层**：网络层正常，问题需要更深入的抓包分析
- **退出 → RCA_FOUND**：代理/证书/白名单问题确认

---

## Layer 7: mitmproxy 抓包

> 这是侵入性较高的诊断层。仅在 Layer 1-6 全部排除后仍无法定位 HTTP 层问题时启用。

### 检查清单

#### Check 7.1: 正常请求是否发出
- **操作**：启动 mitmweb，配置 HTTS_PROXY，重现问题
- **正常现象**：请求正常发出，http status 符合预期
- **异常现象**：请求未发出 → 客户端问题；请求发出但返回异常 → 服务端问题

#### Check 7.2: Request Body 内容
- **操作**：查看 mitmweb 中捕捉到的 request body
- **正常现象**：system prompt、messages、tools 等字段完整
- **异常现象**：body 为空 / 格式错误 / 字段缺失

#### Check 7.3: Response Body 内容
- **操作**：查看 mitmweb 中的 response body
- **正常现象**：有 content blocks 或 streaming chunks
- **异常现象**：body 为空 / 仅含错误信息 / 格式不匹配

#### Check 7.4: TLS 握手
- **操作**：mitmweb 中查看 TLS 握手过程
- **正常现象**：ClientHello → ServerHello → 正常加密通信
- **异常现象**：握手失败 → 证书或协议版本问题

### 进入/退出条件
- **进入**：Layer 5-6 排除但 HTTP 层仍有疑问
- **退出**：抓包结果明确指向问题所在

---

## Layer 8: Wireshark/tcpdump

> 仅在确认是 TCP/TLS 层问题时启用。一般由网络工程师执行。

### 检查清单

#### Check 8.1: DNS 解析
- **操作**：tcpdump 抓 DNS 查询 (port 53)
- **正常现象**：DNS 查询正常返回 IP
- **异常现象**：DNS 无响应或被劫持

#### Check 8.2: TCP 握手
- **操作**：tcpdump 抓 TCP SYN/ACK
- **正常现象**：三次握手正常完成
- **异常现象**：SYN 无响应 / RST / 重传

#### Check 8.3: TLS 握手
- **操作**：Wireshark 中查看 ClientHello/ServerHello
- **正常现象**：TLS 版本和加密套件协商成功
- **异常现象**：TLS 版本不匹配 / 证书验证失败

### 进入/退出条件
- **进入**：Layer 5-7 排除但 TCP/TLS 层仍有疑问
- **退出**：抓包结果明确指向问题

---

## Layer 9: OpenTelemetry

> 提供 span 级别的链路追踪。仅在需要分析性能瓶颈或请求内部细节时启用。

### 检查清单

#### Check 9.1: OTel 是否可用
- **操作**：设置 `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_METRICS_EXPORTER=console`
- **正常现象**：有 metrics/logs 输出
- **异常现象**：无输出 → 检查环境变量

#### Check 9.2: TTFT 延迟
- **操作**：检查 traces 中的 llm_request span
- **正常现象**：TTFT 在合理范围
- **异常现象**：TTFT 异常长 → 网络延迟或模型服务慢

#### Check 9.3: Tool/Hook 延迟
- **操作**：检查 interaction span 下的 tool/hook 子 span
- **正常现象**：延迟在合理范围
- **异常现象**：某 tool/hook 延迟异常 → 该环节瓶颈

#### Check 9.4: Retry 模式
- **操作**：检查 spans 中的 retry 记录
- **正常现象**：偶有 retry
- **异常现象**：大量 retry → 系统性问题

#### Check 9.5: Raw API Bodies（高级）
- **操作**：设置 `OTEL_LOG_RAW_API_BODIES=file:/tmp/claude-api-bodies` 并重现问题
- **⚠️ 极度敏感**：输出包含完整 conversation、tool outputs、request/response JSON
- **正常现象**：bodies 包含完整的 request/response，可用于对比格式
- **异常现象**：request body 缺失字段、response body 格式不匹配 → API 兼容层问题
- **使用后务必清理**：`unset OTEL_LOG_RAW_API_BODIES` 并删除输出文件

---

## Layer 10: Runtime 假设驱动调试

> 面向 CSC 源码级开发。当所有外部诊断层都无法定位根因时，进入源码级的假设驱动调试。本章对应 debug guide 第十二章。

### 层概述

对于 CSC 开发人员，当 JSONL、debug log、抓包等外部手段都无法定位问题时，需要深入源码进行插桩验证。流程遵循「假设 → 插桩 → 复现 → 分析 → 修复 → 验证 → 清理」的标准循环。

### 检查清单

#### Check 10.1: 生成假设并确定插桩点
- **操作**：基于前 9 层的排除结果，锁定可疑代码路径
- **正常现象**：能圈定 2-3 个可疑的源码文件/函数
- **异常现象**：完全无头绪 → 回到 Layer 2 重新收集更多 debug log

#### Check 10.2: 插入结构化调试日志
- **操作**：在可疑路径添加 `logForDebugging()` 调用（`src/utils/debug.ts`）
- **格式**：`[DEBUG-MODE][H<编号>-<假设简称>][<函数名>] key1=value1 key2=value2`
- **示例**：`logForDebugging('[DEBUG-MODE][H1-stale-cache][getUserProfile] cache_key=user:123 hit=true')`
- 注意：使用项目已有的 `logForDebugging()` 函数，不要自己写新的日志逻辑

#### Check 10.3: 复现并收集日志
- **操作**：开启 `--debug` 重现问题，或通过 `bun run dev` 在 dev 模式下运行
- **收集**：`grep '\[DEBUG-MODE\]' ~/.claude/debug/<sessionId>.txt` 提取插桩日志
- **正常现象**：插桩日志清晰展示数据流和异常点
- **异常现象**：插桩点未被触发 → 怀疑的代码路径不对，重新定位

#### Check 10.4: 假设验证与清理
- **操作**：对比插桩日志与预期行为
- 确认假设 → 编写修复代码 → 验证 → 移除调试日志
- 排除假设 → 移除调试日志 → 生成新假设 → 回到 Check 10.1

### 常见假设（按可能性排序）
1. 某异步操作未正确 await，导致状态不一致 — 可能性：中
2. 缓存过期逻辑有 bug，返回了过期数据 — 可能性：中
3. 配置解析路径在特定条件下走了错误分支 — 可能性：低

### 进入/退出条件
- **进入**：Layer 1-9 全部排查完毕仍未找到根因，且开发人员有 CSC 源码访问权限
- **退出 → RCA_FOUND**：插桩日志确认根因
- **退出 → 放弃**：超出当前排障范围，标记为 UNRESOLVED

---

## Layer 10.5: 隔离环境验证

> 当需要排除环境/配置因素时启用。对应 debug guide 第十三章。

### 检查清单

#### Check 10.5.1: 干净配置目录
- **操作**：`CLAUDE_CONFIG_DIR=/tmp/claude-clean csc`
- **正常现象**：干净环境下问题消失 → 问题由某个配置引起
- **异常现象**：干净环境下问题依旧 → 非配置问题

#### Check 10.5.2: 二分法定位配置问题
- **操作**：从干净环境开始，逐步添加文件/配置，直到问题复现
- **顺序**：settings.json → .mcp.json → CLAUDE.md → skills → hooks
- 每添加一项配置后验证问题是否复现

#### Check 10.5.3: 空项目目录验证
- **操作**：在新目录中启动 CSC（无 CLAUDE.md、无 .mcp.json、无 .claude/）
- **正常现象**：可正常启动和运行
- **异常现象**：空目录也有问题 → 全局配置或安装问题
