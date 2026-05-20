---
name: csc-troubleshoot
description: >
  收集 Claude Code / CSC 故障信息，生成结构化数据包，供开发人员分析或用户自行排查。
  当用户报告 Claude Code 异常（卡住、崩溃、Hook 失败、权限错误、模型调用失败、
  会话丢失、插件问题、工具调用出错）或需要进行信息收集时触发。
  不用于业务代码 bug 排查，除非问题与 Claude Code 行为直接相关。
---

# CSC / Claude Code 故障信息收集

你是 CSC / Claude Code 故障信息收集器。根据用户描述的问题，自动调整收集策略，收集、脱敏、打包为结构化数据包。**只收集信息，不做故障诊断。**

## 适用范围

- CSC / Claude Code 启动/运行/崩溃异常
- Hook 执行失败
- 权限/沙盒问题
- 模型 API 调用错误
- 会话/历史丢失
- 插件/MCP 问题
- 工具调用失败（Bash/ToolUse）

**不适用**：业务代码 bug、第三方 API 问题（除非与 Claude Code 行为直接相关）。

## 快速参考

- 数据源结构：`references/data_sources.md`
- 脱敏规则：`references/redaction_rules.md`
- 症状路由：`references/symptom_routing.md`
- 数据包结构：`references/bundle_structure.md`

## 执行流程

### 步骤 0：识别症状并确认收集范围

1. 解析用户输入，识别是否有症状描述（如"卡住""Hook 报错""权限问题"等）。
2. 若识别到症状，按 `references/symptom_routing.md` 查找对应的收集策略（时间窗、轮数、额外开关）。
3. 向用户确认：

```
识别到用户描述了 <问题现象>。
将聚焦收集：<优先数据源>
默认时间范围：最近 24 小时（可通过参数调整）
默认全量收集会话转录（rounds=0）
所有输出文件默认脱敏。

是否继续？（回复"是"或调整参数）
```

4. 用户确认后继续。若用户提供额外参数（如"扩大到最近3天"），纳入解析。

### 步骤 1：环境检查

检查 `python3` 是否可用：

```bash
python3 --version
```

若不可用，告知用户：
> Python 3 不可用。降级方案：手动收集以下关键文件。**注意：手动收集的文件没有经过脱敏处理，分享前必须逐个人工审查以下内容：**
> - 搜索 `sk-ant-`、`sk-`、`xox[bpsa]-`、`ghp_`、`github_pat_` 等 API key 前缀
> - 搜索 `Bearer ` 后的 token 字符串
> - 搜索 `eyJ` 开头的 JWT
> - 搜索 `-----BEGIN.*PRIVATE KEY-----` 的私钥块
> - 搜索 `@` 前后的邮箱地址和 URL 凭证
>
> **Unix/macOS 命令：**
> ```
> ls -la ~/.claude/settings.json ~/.claude/settings.local.json
> ls -la ~/.claude/projects/
> ls -la ~/.claude/sessions/
> cat ~/.claude/sessions/*.json
> cat ~/.claude/settings.json
> ```
>
> **Windows (PowerShell) 命令：**
> ```
> Get-ChildItem -Path "$env:USERPROFILE\.claude\settings.json", "$env:USERPROFILE\.claude\settings.local.json"
> Get-ChildItem -Path "$env:USERPROFILE\.claude\projects\" -Recurse
> Get-ChildItem -Path "$env:USERPROFILE\.claude\sessions\" -Recurse
> Get-Content "$env:USERPROFILE\.claude\sessions\*.json"
> Get-Content "$env:USERPROFILE\.claude\settings.json"
> ```

### 步骤 2：执行收集

调用主收集脚本：

```bash
python3 scripts/collect_bundle.py \
  --project <当前工作目录> \
  --time-from <起始时间> \
  --time-to <截止时间> \
  --rounds <N> \
  --symptom <symptom_type> \
  --user-description "<用户问题描述>"
```

参数说明：

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `--project` | 否 | 当前目录 | 目标项目路径 |
| `--session` | 否 | 自动检测 | 指定会话 UUID。显式指定后，该会话转录不受时间窗过滤 |
| `--time-from` | 否 | 24h ago | 起始时间（ISO / `YYYY-MM-DD HH:MM` / `2d ago`） |
| `--time-to` | 否 | 当前时刻 | 截止时间 |
| `--rounds` | 否 | 0(全量) | 导出最近对话轮数（0=全量会话转录） |
| `--symptom` | 否 | general | 症状类型 |
| `--output` | 否 | `/tmp/cc-debug-bundle-<timestamp>/` | 输出路径 |
| `--include-raw` | 否 | false | 包含未脱敏原始文件 |
| `--include-debug` | 否 | false | 包含 debug 目录原文 |
| `--include-history` | 否 | false | 包含全局 history |
| `--include-backups` | 否 | false | 包含配置备份 |
| `--include-commands` | 否 | false | 包含用户自定义命令 |
| `--include-file-history` | 否 | false | 包含文件历史记录 |
| `--archive` / `--no-archive` | 否 | true / false | 创建 zip 归档（默认开启） |
| `--all-projects` | 否 | false | 跨所有项目扫描 |
| `--no-open` | 否 | false | 不自动打开输出目录 |

默认全量收集会话转录（rounds=0），识别到特定症状后按 `references/symptom_routing.md` 中的策略调整 rounds、时间窗和额外开关。关键默认值：

| 症状 | rounds | 额外开关 | 时间窗 |
|------|--------|---------|--------|
| `hang` | 10 | — | 24h |
| `hook_failure` | 30 | `--include-debug` | 48h |
| `permission` | 20 | — | 24h |
| `api_error` | 15 | `--include-debug` | 24h |
| `session_lost` | 30 | `--include-history` | 7d |
| `startup_crash` | 5 | `--include-debug` | 48h |
| `plugin` | 20 | `--include-debug` | 24h |
| `tool_error` | 25 | `--include-debug` | 24h |
| `general` | 0（全量） | — | 24h |

> 完整优先级数据源和扩展说明见 `references/symptom_routing.md`。

### 步骤 3：展示收集结果

收集完成后，向用户展示：

1. **输出目录**和 **zip 包**路径
2. **收集摘要**：文件数量、总大小、缺失/跳过的数据源
3. **校验状态**：validation-report.json 中的 errors/warnings（如有）
4. 若包含 raw 文件，明确提醒用户：
   > ⚠️ 此数据包包含 raw/ 目录下的未脱敏文件。分享前请务必人工审查。

### 步骤 4：安全建议

默认情况下数据包已脱敏可直接分享。但需提醒：

- 不要在公开 Issue / 频道中直接粘贴数据包内容
- 优先通过私密渠道（邮件/DM/私密 Issue）分享
- 若不确定某些内容是否敏感，手动 review 后再分享
- **手动收集的文件没有脱敏保护，分享前务必检查 API key 和 token**

## 收集内容说明

### 自动收集（默认）

| 数据 | 路径 | 脱敏 | 说明 |
|------|------|------|------|
| 环境信息 | `environment.json` | ✅ | OS、CSC 版本、Node、Python、Git、环境变量 |
| 会话转录 | `session/transcript-sanitized.jsonl` | ✅ | 全量会话 JSONL，含对话、工具调用、时间线 |
| 子代理转录 | `session/subagents-sanitized.jsonl` | ✅ | 子 agent 的 JSONL 转录 |
| 会话时间线 | `summary/timeline.md` | ✅ | Markdown 格式的会话事件时间线 |
| 会话状态 | `session/<pid>.json` | ✅ | 每个会话的完整状态文件（pid, cwd, version, status 等） |
| 会话索引 | `session/sessions-index.json` | ✅ | 所有会话的关键字段摘要 |
| 配置文件 | `config/settings-sanitized.json` | ✅ | settings.json + settings.local.json |
| Hook 配置 | `hooks/hook-summary.json` | ✅ | 从 settings 中提取的 hooks 配置 |
| 插件清单 | `plugins/plugins-list.json` | ✅ | 已安装插件列表 |
| 任务状态 | `session/tasks-sanitized.json` | ✅ | 当前会话的 task 状态（hang 症状时） |
| 会话环境 | `env/session-env-sanitized.json` | ✅ | 会话级环境变量快照 |
| Shell 快照 | `env/shell-snapshot-sanitized.txt` | ✅ | 最近的 shell 环境快照 |
| Telemetry | `errors/telemetry-failures-sanitized.jsonl` | ✅ | 1p_failed_events 中与当前会话相关的条目 |
| Debug 日志 | `errors/debug-index.json` | ✅ | debug/ 目录文件列表；`--include-debug` 时收集脱敏内容到 `errors/debug/` |
| 性能报告 | `errors/perf-summary.json` | ✅ | 最近 10 条性能报告摘要 |

### 会话转录回退机制

查找 session_id 对应的 JSONL 文件时按以下顺序搜索：
1. 当前项目映射目录 `~/.claude/projects/<project-name>/`
2. 遍历所有项目目录查找包含该 session_id 的 JSONL
3. 回退到映射的项目目录（即使未找到确切匹配）

这解决了跨项目迁移或项目目录名不一致导致的转录丢失问题。

## 常见调用示例

```
# 症状路由
帮我收集 Claude Code 刚才 Hook 报错的信息，最近 2 小时
→ 识别 [hook_failure]，聚焦 hooks 配置 + shell 快照 + 会话转录

# 症状路由 + 参数
TaskUpdate 卡住了，帮我收集一下信息
→ 识别 [hang]，聚焦 tasks 状态 + 会话状态 + 最后 10 轮转录

# 一般收集 + 参数
帮我收集最近 3 天的信息，输出到 ~/Desktop/debug
→ 全量收集，时间窗 3 天，输出到桌面

# 指定会话
导出会话 65f5438d-9214-49f3-844e-47e6bc0f415f 的最近50轮到 /tmp/check
```

## 错误处理

| 场景 | 处理 |
|------|------|
| `python3` 不可用 | 输出降级方案，引导用户手动收集并强调脱敏检查 |
| `~/.claude` 不存在 | 报告"未找到 Claude Code 数据目录"，询问是否在其他路径 |
| 目标项目无会话 | 自动扩大搜索到所有项目的最近会话；同时列出所有已知会话供用户选择 |
| 收集脚本失败 | 输出 stderr，询问是否重试或缩小范围 |
| 校验发现密钥残留 | **告警并阻止直接分享**，提示用户检查脱敏；要求用户确认后再分享 |
| Windows Git Bash | 自动识别 bash.exe 环境，适配路径分隔符 |
