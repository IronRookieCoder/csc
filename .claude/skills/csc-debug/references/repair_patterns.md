# 修复模式库

本文档建立根因到修复方案的映射，供 Phase 3 查询匹配。每个模式包含：症状特征、诊断确认方法、修复步骤、验证方法和风险等级。

---

## 索引

| ID | 模式名 | 类别 | 风险 |
|----|--------|------|------|
| RP-01 | settings.json 语法错误 | config | 低 |
| RP-02 | API Key 无效 (401) | auth | 低 |
| RP-03 | API 429 限流 | network | 低 |
| RP-04 | API 5xx 服务端错误 | network | 低 |
| RP-05 | MCP server 启动失败 | mcp | 中 |
| RP-06 | MCP tools=0 | mcp | 中 |
| RP-07 | MCP 未 approval | mcp | 低 |
| RP-08 | Hook matcher 不匹配 | hooks | 低 |
| RP-09 | Hook exit code 错误 | hooks | 中 |
| RP-10 | Hook stdout 污染 JSON | hooks | 中 |
| RP-11 | 权限被 deny | permission | 低 |
| RP-12 | sandbox 限制 | permission | 中 |
| RP-13 | TLS/SSL 证书错误 | network | 中 |
| RP-14 | 代理配置错误 | network | 中 |
| RP-15 | 企业网络白名单 | network | 低 |
| RP-16 | 上下文过大 | context | 低 |
| RP-17 | JSONL 会话损坏 | session | 中 |
| RP-18 | 配置覆盖关系错乱 | config | 低 |
| RP-19 | 环境变量冲突 | env | 中 |
| RP-20 | CLAUDE.md 超过 memory limit | context | 低 |
| RP-21 | 模型畸形响应 — 模型侧缓解 | model | 低 |
| RP-22 | task 工具缺失 tool_use 需重试 | code | 中 |

---

## RP-01: settings.json 语法错误

**症状特征**：CSC 启动即报错、/status 显示配置未加载、某配置项不生效

**诊断确认**：
1. 检查启动日志中的 Zod validation 错误
2. `python3 -m json.tool ~/.claude/settings.json` 验证 JSON 语法
3. 对比 settings.json 与 Schema 定义

**修复步骤**：
1. 修正 JSON 语法（逗号、引号、括号配对）
2. 修正字段名拼写或值类型
3. 保存后重启 CSC，运行 /doctor 确认

**验证方法**：/status 确认配置加载正常，/doctor 无 validation error

**风险等级**：低 | **可自动执行**：是 | **可逆**：是

---

## RP-02: API Key 无效 (401)

**症状特征**：API 请求返回 401、debug log 中有 "Invalid API key" 或 "Unauthorized"

**诊断确认**：
1. debug log (api 分类) 中查找 401 status
2. 运行 `claude auth status --text` 检查认证状态
3. 验证 API key 格式正确

**修复步骤**：
1. 重新获取有效 API key
2. 更新 settings.json 中的 `env.ANTHROPIC_API_KEY` 或对应 provider 的 key
3. 或运行 `/login` 重新配置

**验证方法**：发送简单 prompt 确认能获得正常回复

**风险等级**：低 | **可自动执行**：否（需用户提供 key） | **可逆**：是

---

## RP-03: API 429 限流

**症状特征**：API 返回 429、debug log 中有大量重试记录

**诊断确认**：
1. debug log (api 分类) 中查找 429 status
2. 统计重试频率和间隔
3. 检查 `CLAUDE_CODE_MAX_RETRIES` 和 `API_TIMEOUT_MS` 环境变量

**修复步骤**：
1. 等待 1-2 分钟后重试（通常自动恢复）
2. 可调整 `export CLAUDE_CODE_MAX_RETRIES=2` 减少无效重试
3. 如果持续出现，检查是否短时间发送了过多请求

**验证方法**：发送请求确认返回 200

**风险等级**：低 | **可自动执行**：否 | **可逆**：是

---

## RP-04: API 5xx 服务端错误

**症状特征**：API 返回 500/503/529

**诊断确认**：
1. debug log 中查看 response status code
2. 检查 curl API 端点是否能连通
3. 排除本地代理问题后，确认是服务端问题

**修复步骤**：
1. 等待服务恢复（通常几分钟到几十分钟）
2. 检查 Anthropic Status Page 确认服务状态
3. 如果仅特定模型报错，尝试切换模型

**验证方法**：服务恢复后重试

**风险等级**：低 | **可自动执行**：否 | **可逆**：N/A（非本地问题）

---

## RP-05: MCP server 启动失败

**症状特征**：/mcp 显示 server failed、JSONL 中 MCP 工具调用无响应

**诊断确认**：
1. /mcp 查看 server 状态
2. debug log (mcp 分类) 查看启动命令和错误
3. 手动执行 .mcp.json 中的 command 确认能否正常运行

**修复步骤**：
1. 修正 .mcp.json 中的 command 路径（使用绝对路径）
2. 检查 args 参数格式
3. Windows 下注意路径转义和 PowerShell 兼容性

**验证方法**：/mcp 显示 server connected 且 tools > 0

**风险等级**：中 | **可自动执行**：否 | **可逆**：是

---

## RP-06: MCP tools=0

**症状特征**：/mcp 显示 connected 但 tools=0

**诊断确认**：
1. /mcp 确认 server connected
2. 检查 MCP server 自身的日志/输出
3. 手动运行 MCP server 确认其 tools/list 返回了什么

**修复步骤**：
1. 检查 MCP server 代码中 tools 注册逻辑
2. 确认 MCP server 的 tools/list handler 正常返回
3. 检查 MCP server 版本与 CSC 版本兼容性

**验证方法**：/mcp 显示 tools 数量 > 0，能在对话中使用 MCP 工具

**风险等级**：中 | **可自动执行**：否 | **可逆**：是

---

## RP-07: MCP 未 approval

**症状特征**：MCP server 存在但工具不可用，对话中提示需要 approval

**诊断确认**：
1. /mcp 查看 approval 状态
2. settings.json 中检查 MCP 相关权限配置

**修复步骤**：
1. 在 CSC 中使用 /mcp 命令 approve 对应 server
2. 或在 settings.json 的 permissions 段添加对应的 allow 规则

**验证方法**：MCP 工具在对话中可正常使用

**风险等级**：低 | **可自动执行**：是（通过 /mcp approve） | **可逆**：是

---

## RP-08: Hook matcher 不匹配

**症状特征**：hook 不触发，但配置看起来正确

**诊断确认**：
1. /hooks 查看已注册的 hook 列表
2. 对比 matcher 值与实际工具名（注意大小写）
3. debug log (hooks 分类) 查看 matcher 评估过程

**修复步骤**：
1. 修正 matcher 字符串——严格区分大小写，与工具名完全一致
2. 例如：`"matcher": "Bash"` → `"matcher": "bash"`

**验证方法**：触发对应工具操作，确认 hook 执行

**风险等级**：低 | **可自动执行**：是 | **可逆**：是

---

## RP-09: Hook exit code 错误

**症状特征**：hook 触发了但标记为失败

**诊断确认**：
1. debug log (hooks 分类) 查看 hook 执行的 exit code
2. 使用 exit 2 表示阻止操作，exit 0 表示允许

**修复步骤**：
1. 检查 hook script 的退出码逻辑
2. 如需阻止操作 → `exit 2`；允许 → `exit 0`
3. 非零非 2 的退出码会导致 hook 失败

**验证方法**：触发 hook 后检查操作是否按预期被允许/阻止

**风险等级**：中 | **可自动执行**：否 | **可逆**：是

---

## RP-10: Hook stdout 污染 JSON

**症状特征**：hook 执行后提示 JSON 解析错误

**诊断确认**：
1. debug log 查看 hook 的 stdout 输出
2. hook stdout 应该是纯 JSON，不应包含额外输出

**修复步骤**：
1. 将 hook 的诊断输出改为写入 stderr（`>&2`）
2. 确保 stdout 只输出符合要求的 JSON 结构

**验证方法**：手动运行 hook 命令确认 stdout 为有效 JSON

**风险等级**：中 | **可自动执行**：否 | **可逆**：是

---

## RP-11: 权限被 deny

**症状特征**：工具调用被拒绝，提示权限不足

**诊断确认**：
1. /permissions 查看当前权限规则
2. JSONL 中查看具体被拒绝的工具调用和拒绝原因
3. checkUnreachableRules 检查是否有规则被更宽泛的规则覆盖

**修复步骤**：
1. 在 settings.json 的 permissions.allow 中添加对应工具的权限规则
2. 检查权限模式是否为预期的模式
3. 检查是否有更高优先级的 deny 规则

**验证方法**：重新触发相同操作，确认不再被拒绝

**风险等级**：低 | **可自动执行**：否（需用户确认） | **可逆**：是

---

## RP-12: sandbox 限制

**症状特征**：文件操作或 Bash 命令被 sandbox 阻止

**诊断确认**：
1. /status 确认 sandbox 是否启用
2. JSONL 中查看被阻止操作的具体路径和命令
3. settings.json 中检查 sandbox 配置

**修复步骤**：
1. 调整 sandbox.allowWrite / sandbox.allowRead 的路径白名单
2. 如果不需要 sandbox，disable 它
3. 确保路径格式正确（绝对路径）

**验证方法**：重新执行被阻止的操作，确认通过

**风险等级**：中 | **可自动执行**：否（修改 sandbox 需谨慎） | **可逆**：是

---

## RP-13: TLS/SSL 证书错误

**症状特征**：API 请求报 SSL 错误、`UNABLE_TO_VERIFY_LEAF_SIGNATURE`

**诊断确认**：
1. curl API 端点确认是否有证书问题
2. 检查是否为企业网络部署了 TLS inspection
3. 检查 `NODE_EXTRA_CA_CERTS` 环境变量

**修复步骤**：
1. 设置 `export NODE_EXTRA_CA_CERTS=/path/to/company-ca.pem`
2. 或设置 `export CLAUDE_CODE_CERT_STORE=system`
3. 或设置 `export NODE_TLS_REJECT_UNAUTHORIZED=0`（仅调试用，不可用于生产）

**验证方法**：curl API 端点确认不再报 SSL 错误

**风险等级**：中 | **可自动执行**：否 | **可逆**：是

---

## RP-14: 代理配置错误

**症状特征**：API 请求超时、连接拒绝

**诊断确认**：
1. 检查 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量
2. 检查 `NO_PROXY` 是否意外排除了 API 域名
3. curl 通过代理测试连通性

**修复步骤**：
1. 修正 `HTTPS_PROXY=http://proxy:port` 格式
2. 确保 `NO_PROXY` 不包含 API 域名
3. CSC 不支持 SOCKS 代理

**验证方法**：curl 通过代理能访问 API 端点

**风险等级**：中 | **可自动执行**：否 | **可逆**：是

---

## RP-15: 企业网络白名单

**症状特征**：公司网络下 API 不通，其他网络正常

**诊断确认**：
1. curl 测试关键域名连通性
2. 检查是否有公司防火墙拦截

**修复步骤**：
1. 联系 IT 将以下域名加入白名单：
   - `api.anthropic.com`
   - `claude.ai`
   - `platform.claude.com`
   - `downloads.claude.ai`
   - `storage.googleapis.com`
   - `bridge.claudeusercontent.com`
   - `raw.githubusercontent.com`

**验证方法**：所有域名均可通过 curl 访问

**风险等级**：低 | **可自动执行**：否（需 IT 配合） | **可逆**：N/A

---

## RP-16: 上下文过大 (prompt too long)

**症状特征**：API 报 "prompt too long"、token 数超过模型限制

**诊断确认**：
1. /context 查看上下文占用分布
2. JSONL 中查看 token 使用趋势
3. 检查是否加载了过大的 CLAUDE.md 或 MCP tools 描述

**修复步骤**：
1. 运行 /compact 压缩上下文
2. 精简 CLAUDE.md 内容（超过 MAX_MEMORY_CHARACTER_COUNT 会被警告）
3. 减少同时加载的 MCP tools 数量
4. 或在 settings.json 中排除某些 MCP server

**验证方法**：/context 确认 token 占用在合理范围

**风险等级**：低 | **可自动执行**：是（/compact） | **可逆**：是

---

## RP-17: JSONL 会话损坏

**症状特征**：会话无法恢复、/resume 失败

**诊断确认**：
1. 检查 JSONL 文件是否完整（最后一行是否为有效 JSON）
2. 检查 JSONL 文件大小是否异常（0 字节或极大）

**修复步骤**：
1. 使用 /rewind 回滚到上一个 checkpoint
2. 如果 /rewind 失败，从 `~/.claude/projects/` 手动找到对应的 session JSONL
3. 极端情况：删除损坏的 JSONL，重新开始会话

**验证方法**：/resume 成功恢复会话

**风险等级**：中 | **可自动执行**：否 | **可逆**：部分（数据丢失）

---

## RP-18: 配置覆盖关系错乱

**症状特征**：某配置项设置了但不生效

**诊断确认**：
1. /status 查看配置来源和覆盖顺序
2. 确认是否有更高优先级的 source 覆盖了目标配置
3. 设置来源优先级：flagSettings > localSettings > projectSettings > userSettings > policySettings

**修复步骤**：
1. 在正确的 settings 文件中修改配置
2. 如果想用 localSettings 覆盖 projectSettings，确保 localSettings 文件存在且配置正确
3. 注意 `--settings` CLI flag 会覆盖全部

**验证方法**：/status 确认配置值来自预期的 source

**风险等级**：低 | **可自动执行**：是 | **可逆**：是

---

## RP-19: 环境变量冲突

**症状特征**：设置了环境变量但不生效或被覆盖

**诊断确认**：
1. settings.json 中的 env 段是否覆盖了 shell 环境变量
2. session-env 快照查看实际生效的环境变量值

**修复步骤**：
1. 确认环境变量是在正确的层级设置的（shell env vs settings.env vs .env file）
2. settings.json 中的 env 会覆盖 shell 环境变量
3. 如果 API key 同时存在于环境变量和 settings.json，后者优先

**验证方法**：在 CSC 中运行 `echo $VAR_NAME` 确认值

**风险等级**：中 | **可自动执行**：否 | **可逆**：是

---

## RP-20: CLAUDE.md 超过 memory limit

**症状特征**：/doctor 报 CLAUDE.md 文件大小警告、上下文异常大

**诊断确认**：
1. /context 查看 CLAUDE.md 和 memory files 的 token 占用
2. 检查各层级 CLAUDE.md（全局 + 项目 + 子目录）
3. `checkClaudeMdFiles()` 检测超过 MAX_MEMORY_CHARACTER_COUNT 的文件

**修复步骤**：
1. 精简项目 CLAUDE.md（`D:\agent-coding\csc\CLAUDE.md`）
2. 将详细文档拆分到 docs/ 目录而非 CLAUDE.md
3. 检查全局 CLAUDE.md（`~/.claude/CLAUDE.md`）是否也过大

**验证方法**：/context 确认 memory 类 token 占用下降

**风险等级**：低 | **可自动执行**：否 | **可逆**：是

---

## RP-21: 模型畸形响应 — 模型侧缓解

**症状特征**：
- JSONL 中 assistant message 的 `stop_reason=tool_use` 但 content 仅含 text 块，无 tool_use 块
- 随后出现 `isApiErrorMessage: true` 的错误消息："the model ended with stop_reason=tool_use but did not provide the required tool tool call"
- 多见于使用 OpenAI/Gemini/Grok 兼容层调用第三方模型（如 GLM）时
- 通常是概率性问题——同一场景下有时成功有时失败

**诊断确认**：
1. JSONL 中执行 Check 1.9（stop_reason 与 tool_use 块一致性检查）
2. JSONL 中搜索 `"isApiErrorMessage": true` 确认框架已检测到异常
3. 查看 API 请求快照（`json/*.json`）确认使用的模型和 provider
4. 对比同场景成功案例确认是否使用了不同工具（如成功用 `update_todo_list` 但失败用 `TaskCreate`）

**修复步骤**（纯模型侧，不修改源码）：
1. 如果是特定模型问题，切换到更稳定的模型（在 settings.json 中修改 model 配置或通过 `/login` 切换）
2. 如果是特定工具触发概率高，在 CSC 对话中引导模型使用备用工具（如用 `update_todo_list` 替代 TaskCreate/TaskUpdate）
3. 如果是 provider 转换问题，尝试切换到同模型的不同 provider（如 GLM 用 OpenAI 兼容层有问题，换成原生 Anthropic 协议端点）

**验证方法**：
1. 使用同模型重现原问题场景，确认切换模型/工具后不再出现畸形响应
2. 连续 3 次相同操作均正常完成

**风险等级**：低 | **可自动执行**：部分（模型切换可自动） | **可逆**：是

**说明**：本模式仅覆盖模型侧缓解方案。如果确定是 task 工具类（TaskCreate/TaskUpdate/TaskList/TaskGet）的畸形响应需要源码级修复，参见 RP-22。

---

## RP-22: task 工具缺失 tool_use 需重试

**症状特征**：
- 与 RP-21 相同：`stop_reason=tool_use` 但 content 无 tool_use 块
- 区别在于：此模式聚焦于**特定工具类别**（TaskCreate/TaskUpdate/TaskList/TaskGet）的处理逻辑缺陷
- 非 task 类工具遇到同样问题有一次重试机会，但 task 类直接失败

**诊断确认**：
1. 确认畸形响应中涉及的工具名称属于 task 工具集合（TaskCreate/TaskUpdate/TaskList/TaskGet）
2. 阅读 `src/query.ts` 中 `isTaskRelatedMissingToolUseResponse` 函数（约第 208-220 行）— 确认触发了此检测
3. 阅读同文件 task 类错误处理路径（约第 1392-1439 行）— 确认 task 类直接 fail 而非重试

**修复步骤**：
1. 在 `src/query.ts` 中删除第 1392-1398 行 task 相关提前返回
2. 让 task 相关缺失 tool_use 情况也走到第 1400 行的通用恢复逻辑（发送重试请求）
3. `isTaskRelatedMissingToolUseResponse` 函数保留，但仅用于分类/日志记录，不再决定是否重试
4. 在修复代码处添加注释说明为何 task 与非 task 统一处理

**验证方法**：
1. 使用触发概率最高的模型 + task 工具组合重现场景
2. 确认畸形响应后有一次自动重试，重试后正常完成或第二次失败后有明确错误提示
3. 运行 `bun test` 确认相关测试通过
4. 运行 `bun run precheck` 确保类型检查和 lint 通过

**风险等级**：中 | **可自动执行**：否（源码修改需人工确认） | **可逆**：是
