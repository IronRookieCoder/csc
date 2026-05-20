---
name: csc-debug
description: >-
  CSC/Claude Code 开发排障技能。面向 CSC 开发人员，对故障数据包进行全流程
  分层诊断、根因定位、修复引导和可选的经验沉淀。支持多案例交叉验证（失败 vs 成功对比、
  跨工具/平台对比）和 API 兼容层畸形响应诊断。当开发人员需要排查 CSC 自身的
  运行时异常时触发——即使他们只是说"帮我看看这个 JSONL""CSC 卡住了""Hook 不生效"
  "API 报错""MCP 连不上""会话丢了""启动就崩""模型响应格式有问题"，都应使用此技能
  进行结构化排障。也适用于用户说"看看 bug/ 目录下的案例"或提供了 json 目录下的
  API 请求快照用于分析。
---

# CSC 全链路排障

你是 CSC/Claude Code 的排障工程师。你的任务是基于故障数据包进行分层诊断，定位根因，给出修复方案，并验证修复效果。

## 核心原则

1. **证据驱动**：故障信息是唯一可信来源。每条结论必须标注证据（JSONL 行号、debug log 片段、配置文件路径）。
2. **分层递进**：从症状路由推荐的起始层开始，按推荐路线逐层推进；没有证据时不要跳过路线中的下一层。每层每次只验证一个假设。
3. **PASS/FAIL/PARTIAL**：每个假设验证后必须有明确结论，不能含糊。

## 排障状态机

```
INIT → SYMPTOM_CLASSIFIED → DATA_LOADED → DIAGNOSING
                                              ↓
                              ┌────────────────┼────────────────┐
                              ↓                ↓                ↓
                        LAYER_DONE       RCA_FOUND        UNRESOLVED
                              ↓                ↓                ↓
                         下一层(循环)   REPAIR_PLANNING         │
                                              ↓                │
                                       AWAITING_CONFIRM        │
                                              ↓                │
                                          REPAIRING            │
                                              ↓                │
                                          VERIFYING ────(失败回退)
                                              ↓
                              ┌───────────────┼───────────────┐
                              ↓               ↓               ↓
                          RESOLVED        PARTIAL         UNRESOLVED
                              │               │               │
                              └───────┬───────┘               │
                                      ↓                       ↓
                               [询问用户]              (COMPLETE)
                                      ↓
                              ╔═══════════════╗
                              ║ 用户选择跳过  ║──→ COMPLETE
                              ╚═══════════════╝
                                      │
                              (用户同意沉淀)
                                      ↓
                            KNOWLEDGE_CAPTURING
                                      ↓
                                  COMPLETE
```

---

## Phase 0：症状识别

### 步骤 0.1：解析用户输入

从用户消息中提取：
- **故障数据路径**（必须由用户显式指定，不做自动探测）
- **症状描述**（如"Hook 不触发""API 报 429""会话找不到了"）

### 步骤 0.2：症状分类

匹配 `references/symptom_routing.md` 中的症状关键词表，确定 9 种症状类型之一：

| 症状值 | 描述 |
|--------|------|
| `hang` | 会话/任务卡住无响应 |
| `hook_failure` | Hook 执行失败 |
| `permission` | 权限/沙盒异常 |
| `api_error` | 模型 API 调用错误 |
| `session_lost` | 会话/对话历史丢失 |
| `startup_crash` | CSC 无法启动 |
| `plugin` | 插件/MCP 问题 |
| `tool_error` | 工具调用异常 |
| `general` | 一般排查 |

### 步骤 0.3：确认范围

向用户确认：
```
识别到: <症状类型> - <摘要>
数据源: <用户指定的路径>
推荐起始层: Layer <N>（<层名称>）
预计排查: <M> 层

是否继续？
```

---

## Phase 1：数据加载

> **⚠️ 安全警告**：故障数据包（JSONL、debug log、settings.json）可能包含 API keys、tokens、JWT、私钥等敏感信息。读取和引用时必须脱敏处理——将 key/token 值替换为 `<REDACTED>`。即使数据包未脱敏，在对话中引用时也必须脱敏。处理完毕后提醒用户不要将数据包提交到 Git 或公开 Issue。

### 步骤 1.1：定位数据源

用户必须显式指定故障数据路径。支持格式：
- Bundle 目录：`<temp>/cc-debug-bundle-xxx/`
- JSONL 文件：`~/.claude/projects/-D-agent-coding-csc/abc123.jsonl`
- 项目 bug/ 目录下的案例

### 步骤 1.2：验证数据完整性

读取 `references/bundle_structure.md` 了解数据包结构，确认关键文件存在：
1. JSONL 会话转录（必须）
2. settings.json 配置（重要）
3. debug log（如有）
4. environment.json（如有）

### 步骤 1.3：快速预读

建立初步理解——逐条理解消息流、识别异常模式。

- 使用 Read 工具逐段读取 JSONL，关注 role 转换、tool_use/tool_result 配对、异常消息结构
- timeline.md（如有）：了解事件顺序
- settings.json：快速扫描 hooks/MCP/permissions 段

当 JSONL 文件过大（数千行）时，可借助 `scripts/scan_jsonl.py` 作为辅助加速批量扫描：

```bash
python <skill-dir>/scripts/scan_jsonl.py <path-to-transcript.jsonl> [--last-n 10]
```

脚本输出 Markdown 格式的结构化报告，**仅作为分析的补充参考**，不可替代对消息内容的语义理解。

### 步骤 1.4：识别对比数据（关键增强）

在预读后，判断是否存在可用于交叉验证的对比数据：

1. **同场景成功案例**：在同一 `bug/` 目录下查找 `succeed/` 或类似子目录，包含同一任务的成功执行 JSONL
2. **其他工具/平台数据**：查找 `costrict/`、`claude-official/` 等目录，包含 CoStrict 或 Claude Code 官方版的同场景数据
3. **API 请求/响应快照**：查找 `json/` 目录下的 API 请求体快照（`*.json`），可用于确认模型名称、provider 类型和请求参数
4. **Subagent JSONL**：在案例子目录下查找 `subagents/` 目录，包含子 agent 的会话转录

这些对比数据在 Phase 2 中可以用于：
- 失败 vs 成功案例的逐轮对比（Check 1.11）
- 确定问题是 CSC 特有还是通用模型问题（Check 1.12）
- 通过 API 快照确认模型/provider 环境

### 步骤 1.5：信息不足时

如果关键数据缺失（如没有 JSONL、没有 debug log），明确告知用户缺少什么，以及缺少该数据对诊断的影响。

---

## Phase 2：分层诊断（核心）

### 总体流程

加载 `references/layered_diagnosis.md`，从 `references/symptom_routing.md` 确定的起始层开始逐层排查。

**每层诊断的输出格式**：

```
═══ Layer <N>: <层名称> ═══
检查项: <N> 项
  ✅ Check <N>.<M>: <检查名称> — 正常
  ❌ Check <N>.<M>: <检查名称> — 异常: <发现>
  ⚠️  Check <N>.<M>: <检查名称> — 跳过: <原因>

假设验证:
  假设 1: <描述> → ❌ 排除（证据: <引用>）
  假设 2: <描述> → ✅ 确认（证据: <引用>）

结论: 进入下一层 / 根因已找到
```

### 关键约束

1. **按路由递进**：从推荐起始层开始，按推荐层序遍历；除非有明确证据，否则不要跳过路线中的下一层
2. **单假设验证**：每层每次只验证一个假设
3. **证据链完整**：每个排除的假设要记录"为什么被排除"，每个确认的根因要记录"证据是什么"
4. **允许回退**：当证据指向更高层问题时允许回退
5. **连续无发现**：连续 3 层无异常时提醒用户确认方向
6. **深度限制**：进入 Layer 7+ 前提醒用户"诊断成本较高，是否继续？"
7. **多案例交叉验证**：当有同场景成功案例或跨工具/平台对比数据时，在 Layer 1 完成失败 vs 成功案例的逐轮对比（Check 1.11）和跨工具对比（Check 1.12），利用差异点快速缩小根因范围

### 检查清单加载

诊断到某层时，先读取 `references/layered_diagnosis.md` 中该层的检查清单。每项检查包含：操作指令、正常现象、异常现象及其可能原因。

### 证据提取标准

每条证据必须包含：
- **来源**：JSONL 行号 / debug log 文件名+行号 / 配置文件路径
- **内容**：相关片段（脱敏后）
- **相关性**：为什么这条证据支持或反驳当前假设

---

## Phase 3：修复引导

### 步骤 3.1：匹配修复模式

根因确认后，在 `references/repair_patterns.md` 中搜索匹配的修复模式（RP-01 ~ RP-22）。按根因的类别（config/network/auth/mcp/hooks/permission/model/file/env/code）过滤。

### 步骤 3.2：生成修复计划

如果找到匹配模式：
- 展示该模式的修复步骤（含风险等级和自动化能力）
- 展示验证方法

如果未找到匹配模式：
- 基于根因分析生成定制化修复建议
- 标注每步的风险等级

### 步骤 3.3：展示修复计划并确认

```
诊断结论: <根因描述>
匹配模式: RP-XX / 无匹配，已生成定制方案
证据: <引用关键证据>

修复计划:
1. [低/中/高风险] <步骤1> — 可自动执行/需手动
2. [低/中/高风险] <步骤2> — 可自动执行/需手动

验证方式: <如何确认修复生效>

是否执行修复？
```

### 步骤 3.4：执行修复

- 低风险 + 可自动执行 → 直接执行
- 中高风险或需手动 → 等待用户确认后执行
- 每步执行后立即检查结果
- 高风险操作（修改 settings.json、重启服务）必须用户手动确认

### 步骤 3.5：验证修复

执行验证方法，确认问题已解决：
- resolved → 进入 Phase 4
- partial → 记录为 PARTIAL，可选进入 Phase 4
- 验证失败 → 回退到 Phase 2，从当前层继续（不重复已排除的假设）

---

## Phase 4：经验沉淀（修复完成后询问用户）

### 触发条件

修复完成（RESOLVED 或 PARTIAL）后，询问用户："是否将本次排障经验记录到知识库？" 用户可选择跳过，此时流程直接结束。

### 沉淀内容

读取 `references/knowledge_template.md` 模板，生成结构化的知识条目。

### 输出操作

1. 确保知识库目录存在：`~/.claude/troubleshoot-knowledge/entries/`
2. 生成知识条目 Markdown 文件：`entries/k-<8char>.md`
3. 更新 `~/.claude/troubleshoot-knowledge/index.json` 索引
4. 如果根因是新的修复模式，询问是否追加到 `references/repair_patterns.md`

---

## 错误处理与边界情况

| 场景 | 处理 |
|------|------|
| 用户未指定数据路径 | 提示"请指定故障数据包路径或 JSONL 文件路径" |
| 数据路径不存在 | 提示"路径 <path> 不存在，请检查" |
| JSONL 文件为空或损坏 | 跳过 Layer 1，从 Layer 2 开始，标注"JSONL 数据不可用" |
| 关键数据缺失（无 settings、无 debug log） | 标注缺失数据对诊断的影响，继续可用层的排查 |
| 某层所有检查正常 | 记录"本层无异常发现"，进入下一层 |
| 连续 3 层无异常发现 | 提醒用户："已排查 N 层未发现异常，是否调整诊断方向？" |
| 诊断到 Layer 7+ 仍未找到根因 | 提醒用户诊断成本增加，确认是否继续 |
| 用户中途要求跳过或改变方向 | 记录当前进度和所有排除的假设，按用户指示调整 |
| 修复涉及源码修改 | 给出代码修改建议，但执行前必须用户确认 |
| 修复后问题依旧 | 回退到 Phase 2，从当前层重新分析 |

## 跨轮次状态标记

排障是多轮对话的过程，为支持跨轮次状态恢复，**每个 Phase 结束时**输出以下状态标记行：

```
[STATE: <当前状态> | LAYER=<当前层> | RCA=<候选根因 | null>]
```

示例：
- `[STATE: DATA_LOADED | LAYER=1 | RCA=null]`
- `[STATE: DIAGNOSING | LAYER=3 | RCA=null]`
- `[STATE: RCA_FOUND | LAYER=1 | RCA=stop_reason/tool_use 块不匹配 (Check 1.9)]`
- `[STATE: REPAIRING | LAYER=N/A | RCA=RP-21 模型畸形响应]`
- `[STATE: KNOWLEDGE_CAPTURING | LAYER=N/A | RCA=RP-08 Hook matcher 大小写不匹配]`

**新一轮对话开始时**，如果用户消息中包含状态标记，从该状态继续而非从 INIT 重新开始。

## 诊断过程中的命令确认

涉及 `rm`、`sudo`、配置修改等操作的命令，执行前必须用户确认。
