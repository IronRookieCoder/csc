# Claude Code 全链路 Debug 指南
## 一、调试体系总览

Claude Code 的问题通常分布在以下几个层次：

```text
用户输入
  ↓
Claude Code CLI / Desktop / IDE
  ↓
配置与上下文加载
  - CLAUDE.md
  - settings.json / settings.local.json
  - skills
  - agents
  - hooks
  - MCP
  - permissions
  ↓
本地会话记录（JSONL）
  ~/.claude/projects/<project>/<session>.jsonl
  ↓
API 请求
  - api.anthropic.com
  - claude.ai
  - platform.claude.com
  - 企业代理 / VPN / TLS inspection
  ↓
Anthropic 服务端
  ↓
Claude Code 工具调用循环
  - Read / Edit / Bash / Search / MCP / Hook / Agent
  ↓
工具结果回写 JSONL
  ↓
下一轮请求继续携带上下文
```

推荐的排查优先级：

```text
1. /status /doctor /context
2. ~/.claude/projects/*.jsonl
3. claude --debug "api,mcp,hooks"
4. MCP / Hooks / Permissions
5. curl + 代理 + CA 证书
6. mitmproxy / Charles / Fiddler
7. OpenTelemetry
8. tcpdump / Wireshark
9. CLAUDE_CONFIG_DIR 干净环境复现
```

---

# 二、Layer 1：JSONL 会话记录

## 文件结构

Claude Code 会在主目录创建 `~/.claude` 隐藏目录，保存全局状态、会话、调试日志等：

```text
~/.claude/
├── history.jsonl
├── projects/
│   └── -Users-me-myproject/
│       ├── sessions-index.json
│       ├── <uuid>.jsonl
│       ├── subagents/
│       └── tool-results/
└── debug/
```

Windows：

```powershell
%USERPROFILE%\.claude
```

官方说明：

- `projects/<project>/<session>.jsonl` 是完整 conversation transcript
- 包含用户消息、Claude 响应、工具调用、工具结果
- 大工具输出可能落到 `tool-results/`
- 所有内容均为明文

⚠️ 如果 Claude 读取 `.env`、命令输出 token、API key、数据库密码，这些内容也可能进入 JSONL。

---

## JSONL 文件路径编码规则

Session 存储路径：

```text
~/.claude/projects/<encoded-cwd>/*.jsonl
```

其中：

```text
/Users/me/proj
→
-Users-me-proj
```

即：

- 每个非字母数字字符都会替换成 `-`
- cwd 不一致时，resume 常会进入错误 session

---

## JSONL 文件内容

每一行都是一个事件：

- 用户输入
- Claude 回复
- tool_use
- tool_result
- 文件修改
- token usage
- 模型信息

常见字段：

```json
{
  "type": "assistant",
  "message": {
    "content": [...],
    "usage": {
      "input_tokens": 1234,
      "output_tokens": 567
    }
  }
}
```

---

## 常用 jq 查询命令

### 提取所有 Claude 文本回复

```bash
cat session.jsonl | jq -r '.message.content[]? | select(.type == "text") | .text'
```

### 统计工具调用次数

```bash
cat session.jsonl |
  jq -r '.message.content[]? | select(.type == "tool_use") | .name' |
  sort | uniq -c
```

### 找回所有 Write/Edit 操作

```bash
cat crashed-session.jsonl |
  jq -r '.message.content[]? | select(.name == "Write" or .name == "Edit") | .input'
```

### 搜索关键词

```bash
grep -A5 -B5 "edge case" ~/.claude/projects/my-feature/*.jsonl
```

### 统计 session token 消耗

```bash
for f in ~/.claude/projects/*/*.jsonl; do
  echo "$f: $(cat $f | jq '.message.usage.input_tokens' | paste -s -d+ - | bc) tokens"
done | sort -t: -k2 -n
```

### 实时观察当前 session

```bash
tail -f ~/.claude/projects/<project>/<session>.jsonl
```

---

## JSONL 可解决的问题

| 问题 | 能看到什么 |
|---|---|
| Claude 为什么误判需求 | 用户 prompt、历史上下文 |
| Claude 为什么改错文件 | Read/Edit/Write 工具链 |
| Bash 为什么失败 | stdout/stderr/exit code |
| MCP 返回了什么 | MCP tool_result |
| 是否泄露敏感信息 | 文件读取、命令输出 |
| 是否上下文过大 | 长历史、大文件、大输出 |
| subagent 做了什么 | subagents/ |

---

## JSONL 可视化工具

### claude-JSONL-browser

GitHub：

```text
https://github.com/withLinda/claude-JSONL-browser
```

作用：

- JSONL → Markdown
- 浏览器查看
- 可读性更高

### claude-code-log

GitHub：

```text
https://github.com/daaain/claude-code-log
```

作用：

- token usage timeline
- message filter
- HTML 报告
- timeline 缩放

---

# 三、Layer 2：进程级调试（--debug）

## 启动 Debug

官方 CLI 支持：

```bash
claude --debug
```

支持分类过滤：

```bash
claude --debug "api,mcp"
claude --debug "api,hooks"
claude --debug "!statsig,!file"
```

指定 debug 文件：

```bash
claude --debug-file /tmp/claude.log
```

推荐：

```bash
claude --debug "api,mcp,hooks" --debug-file ./claude-debug.log
```

然后另一个终端：

```bash
tail -f ./claude-debug.log
```

默认 debug 文件位置：

```text
~/.claude/debug/<session-id>.txt
```

---

## Debug 分类建议

### API 调试

```bash
claude --debug "api"
```

适合：

- 429
- 500
- timeout
- request rejected
- auth 问题

---

### MCP 调试

```bash
claude --debug "mcp"
```

适合：

- MCP server failed
- tools 数量为 0
- stderr 调试

---

### Hooks 调试

```bash
claude --debug "hooks"
```

适合：

- matcher 不生效
- hook 不触发
- stdout/stderr 调试

---

# 四、Layer 2.5：Claude 内部 Slash Commands

## /doctor

```text
/doctor
```

检查：

- 安装状态
- 配置错误
- 权限问题
- 网络连接
- schema 错误

按 `f` 可自动修复部分问题。

---

## /status

```text
/status
```

查看：

- managed settings
- user settings
- project settings
- local settings
- 当前覆盖关系

适合排查：

- settings 不生效
- permissions 不生效
- env 被覆盖

---

## /context

```text
/context
```

查看：

- context 占用
- system prompt
- MCP tools
- memory
- skills
- conversation history

适合：

- context pressure
- CLAUDE.md 是否加载
- token 占用过高

⚠️ `/compact` 是压缩上下文，不是调试工具，但在 context pressure 排查时非常有用。

---

## /hooks

```text
/hooks
```

查看：

- 当前 session hooks
- matcher
- 来源
- command
- event

适合：

- hook 是否被读取
- matcher 是否匹配

---

## /mcp

```text
/mcp
```

查看：

- MCP 连接状态
- tools 数量
- approval 状态

适合：

- server connected 但 0 tools
- 项目 MCP 未 approve

---

## /permissions

```text
/permissions
```

查看：

- allow
- deny
- permission scope

---

## /debug

```text
/debug
```

中途开启 debug，无需重启 Claude。

---

## /rewind

```text
/rewind
```

回滚到 checkpoint。

适合：

- 错误修改恢复
- prompt 回退
- 调试错误响应

---

# 五、Layer 3：MCP 调试

## 查看 MCP 状态

```text
/mcp
```

重点检查：

- server failed
- connected but 0 tools
- approval
- 相对路径
- env

---

## MCP CLI 调试

```bash
claude mcp list
```

```bash
claude --debug "mcp"
```

---

## MCP 常见问题

| 问题 | 原因 |
|---|---|
| 看不到 MCP | .mcp.json 不在根目录 |
| failed | command/args/path 错误 |
| connected 但 0 tools | server 未返回 tools |
| 项目 MCP 不加载 | 未 approve |
| env 不生效 | env 放错位置 |
| Windows 失败 | PowerShell/path 转义 |

---

# 六、Layer 4：Hooks 调试

## hooks debug

```bash
claude --debug "hooks"
```

或者：

```bash
claude --debug-file ./hooks-debug.log
```

实时查看：

```bash
tail -f ./hooks-debug.log
```

---

## hooks 调试信息

可看到：

- 哪些 matcher 被评估
- 哪些 hook 被匹配
- stdout
- stderr
- exit code

---

## Hook 调试示例

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "echo \"Executing: $(jq -r '.tool_name')\" >&2"
      }]
    }]
  }
}
```

⚠️ 建议输出到 stderr，而不是 stdout。

---

## Hooks 常见问题

| 问题 | 原因 |
|---|---|
| hook 不触发 | matcher 写错 |
| Bash 不生效 | matcher 大小写错误 |
| hook 没加载 | hooks 放错文件 |
| exit 无效 | 应使用 exit 2 |
| JSON 输出失败 | stdout 被污染 |

---

# 七、Layer 5：API / 服务端调试

## 常见错误

```text
API Error: 500
Repeated 529 Overloaded errors
Request timed out
Request rejected (429)
Invalid API key
Unable to connect to API
SSL certificate verification failed
Prompt too long
```

---

## 自动重试

Claude Code 默认：

```text
CLAUDE_CODE_MAX_RETRIES=10
API_TIMEOUT_MS=600000
```

可修改：

```bash
export CLAUDE_CODE_MAX_RETRIES=2
export API_TIMEOUT_MS=120000
```

---

## API Debug

```bash
claude --debug "api" --debug-file ./api-debug.log
```

认证状态：

```bash
claude auth status --text
```

连通性：

```bash
curl -I https://api.anthropic.com
curl -I https://claude.ai
curl -I https://platform.claude.com
```

---

# 八、Layer 6：代理、CA 与企业网络

## HTTP/HTTPS Proxy

支持：

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
```

支持 NO_PROXY：

```bash
export NO_PROXY="localhost,127.0.0.1"
```

支持：

- 空格分隔
- 逗号分隔
- `*`

⚠️ 不支持 SOCKS Proxy。

---

## 企业 CA

```bash
export NODE_EXTRA_CA_CERTS=/path/to/company-ca.pem
```

当前默认：

```text
CLAUDE_CODE_CERT_STORE=bundled,system
```

可修改：

```bash
export CLAUDE_CODE_CERT_STORE=system
```

---

## 网络白名单

企业环境需检查：

```text
api.anthropic.com
claude.ai
platform.claude.com
downloads.claude.ai
storage.googleapis.com
bridge.claudeusercontent.com
raw.githubusercontent.com
```

---

# 九、Layer 7：网络抓包（mitmproxy）

## 正向代理（推荐）

安装：

```bash
pip install mitmproxy
```

启动：

```bash
mitmweb --listen-port 8080
```

配置代理：

```bash
export HTTPS_PROXY=http://127.0.0.1:8080
export HTTP_PROXY=http://127.0.0.1:8080
```

让 Claude 信任 mitmproxy CA：

```bash
export NODE_EXTRA_CA_CERTS="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
```

启动 Claude：

```bash
claude --debug "api"
```

---

## mitmweb 过滤器

只看 Anthropic：

```text
~d api.anthropic.com
```

---

## 可看到什么

- URL
- request body
- response body
- HTTP status
- request-id
- TLS
- CONNECT
- proxy rewrite
- stream 中断

---

## 反向代理模式

```bash
mitmweb --mode reverse:https://api.anthropic.com --listen-port 8000
```

```bash
export ANTHROPIC_BASE_URL="http://localhost:8000"
claude
```

适合：

- 自动化分析
- replay
- script extraction

---

## mitmproxy addon 示例

```python
import json
import mitmproxy.http


def request(flow: mitmproxy.http.HTTPFlow):
    if "api.anthropic.com" in flow.request.pretty_host:
        try:
            body = json.loads(flow.request.content)
            system = body.get("system", "")
            with open("system_prompts.txt", "a") as f:
                f.write(f"=== {flow.request.timestamp_start} ===\\n{system}\\n\\n")
        except Exception:
            pass
```

运行：

```bash
mitmweb -s dump_claude_prompts.py
```

---

## 调试结束后清理

```bash
unset HTTP_PROXY HTTPS_PROXY NODE_EXTRA_CA_CERTS
```

macOS 删除 mitmproxy CA：

```bash
sudo security delete-certificate -c mitmproxy /Library/Keychains/System.keychain
```

删除抓包：

```bash
find ~/claude-analysis -name "*.mitm" -delete
```

---

# 十、Layer 8：Wireshark / tcpdump

## tcpdump

```bash
sudo tcpdump -i any -w claude-code.pcap tcp port 443
```

macOS：

```bash
sudo tcpdump -i en0 -w claude-code.pcap tcp port 443
```

---

## Wireshark 能看到什么

- DNS
- TCP handshake
- TLS ClientHello
- SNI
- 证书链
- 超时
- 重传
- RST
- CONNECT

⚠️ 默认看不到 HTTPS body。

---

## TLS 解密

可使用：

```bash
export SSLKEYLOGFILE=/tmp/ssl-keys.log
```

然后在 Wireshark TLS 配置中导入 key log。

---

# 十一、Layer 9：OpenTelemetry

## 开启 OTel

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=console
export OTEL_LOGS_EXPORTER=console
claude
```

---

## 输出 Raw API Bodies

⚠️ 极度敏感。

```bash
export OTEL_LOG_RAW_API_BODIES=1
```

输出到文件：

```bash
export OTEL_LOG_RAW_API_BODIES=file:/tmp/claude-api-bodies
```

包含：

- 完整 conversation
- tool outputs
- request/response JSON

---

## 开启 traces

```bash
export CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
export OTEL_TRACES_EXPORTER=console
```

可看到：

- interaction span
- llm_request span
- request_id
- token
- TTFT
- tool latency
- hook latency
- retry

---

# 十二、Layer 10：Runtime 假设驱动调试

## 标准流程

```text
Bug 描述
→ 生成假设
→ 插桩
→ 复现
→ 分析日志
→ 修复
→ 验证
→ 清理
```

---

## Debug 日志格式

```text
[DEBUG-MODE][H1-stale-cache][getUserProfile] cache_key=user:123 hit=true
[DEBUG-MODE][H2-race-condition][updateUser] lock_acquired=false
```

---

## Runtime Pipeline

实时 pipe：

```bash
npm run test 2>&1 | tee outfile | claude
```

输出到文件：

```bash
node repro.js > debug.log 2>&1
```

grep：

```bash
grep '\[DEBUG-MODE\]' debug.log
grep -C 2 'Exception' debug.log | head -n 50
```

---

# 十三、隔离环境与归零排查

## 干净配置目录

```bash
mkdir -p /tmp/claude-clean
CLAUDE_CONFIG_DIR=/tmp/claude-clean claude
```

作用：

- 绕过 ~/.claude
- 排除历史配置污染
- 排除 hooks / MCP / permissions 干扰

推荐同时：

- 不使用 `.mcp.json`
- 不使用 `CLAUDE.md`
- 空项目目录启动

---

# 十四、最终推荐 Debug 组合

## 日常问题定位（80%）

```bash
claude --debug "api,mcp,hooks" --debug-file ./claude-debug.log
```

Claude 内执行：

```text
/status
/context
/doctor
/mcp
/hooks
/permissions
```

再观察：

```bash
tail -f ~/.claude/projects/<project>/<session>.jsonl
```

---

## 网络与 API 深度问题

```text
mitmproxy
+
HTTPS_PROXY
+
NODE_EXTRA_CA_CERTS
+
OTEL_LOG_RAW_API_BODIES
```

---

## 复杂 Runtime Bug

```text
Runtime 插桩
+
structured logs
+
假设驱动调试
```

---

# 十五、安全注意事项

⚠️ 以下文件都可能包含：

- API Key
- Token
- Cookie
- OAuth 信息
- 数据库密码
- 用户 Prompt
- 企业源码
- 文件内容

包括：

```text
~/.claude/projects/*.jsonl
~/.claude/debug/*
mitmproxy 抓包
OTEL raw bodies
stdout/stderr
```

因此：

- 不要提交到 GitHub
- 不要上传公开 issue
- 调试结束及时清理
- 企业环境建议脱敏

