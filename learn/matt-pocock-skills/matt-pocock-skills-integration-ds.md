# Matt Pocock Skills 集成设计方案

## 背景

[D:\third\skills](D:\third\skills) 是 Matt Pocock（TypeScript 知名讲师）维护的一套编码 Agent 技能（slash commands），核心理念是把传统软件工程最佳实践注入 AI 辅助开发流程。本文档评估其与 CSC 项目的集成策略。

---

## 一、源仓库分析

### 1.1 技能清单

| 技能 | 分类 | 核心机制 | CSC 等价物 |
|------|------|----------|------------|
| `/grill-me` | productivity | 一问一答审问式对话，穷尽设计分支 | 无（部分理念含于 strict:plan 需求澄清） |
| `/grill-with-docs` | engineering | 同上 + 同步维护 CONTEXT.md 和 ADR | 无 |
| `/tdd` | engineering | 红-绿-重构，垂直切片，行为测试 | `strict-test`（流程相似，理念不同） |
| `/diagnose` | engineering | 6 阶段结构化调试循环 | **无** |
| `/triage` | engineering | Issue 状态机分类 | 无 |
| `/to-issues` | engineering | 计划拆为独立 Issues | 无 |
| `/to-prd` | engineering | 对话上下文合成 PRD | `strict:plan` / `strict:spec` |
| `/zoom-out` | engineering | 系统视角高层概览 | 无 |
| `/prototype` | engineering | 可丢弃原型验证 | 无 |
| `/improve-codebase-architecture` | engineering | 深模块寻找 + 架构改进 | 无 |
| `/caveman` | productivity | 极致压缩 token 消耗 | 无 |
| `/handoff` | productivity | 会话交接文档 | 无 |
| `/write-a-skill` | productivity | 创建新 skill | `skillify` |

### 1.2 可提取的设计模式

Matt Pocock 技能的核心价值不在具体实现，而在**可复用的 prompt 工程模式**：

**模式 A — 审问式澄清（Grilling）**：Agent 每次只问一个问题，附带推荐答案，用户只需确认/修正。解决"Agent 盲目假设用户意图"的问题。

**模式 B — 垂直切片（Tracer Bullet）**：一次 RED→GREEN 一个行为，而非水平写完所有测试再写实现。解决"测试变成实现细节的镜像"的问题。

**模式 C — 共享语言（Shared Language / CONTEXT.md）**：项目术语表让 Agent 用领域词汇而非泛化描述交流。解决"Agent 用 20 个词描述 1 个概念"的问题。

---

## 二、CSC 现有基础设施（代码级验证）

以下结论均基于实际代码阅读，非推测。

### 2.1 Skill 注册机制

`src/skills/bundledSkills.ts` 提供 `registerBundledSkill()` API，接受 `BundledSkillDefinition`：

```typescript
// 已验证：src/skills/bundledSkills.ts (line 14-45)
type BundledSkillDefinition = {
  name: string
  description: string
  allowedTools?: string[]
  context?: 'inline' | 'fork'
  agent?: string
  files?: Record<string, string>         // 附带资源文件
  getPromptForCommand: (args, context) => Promise<ContentBlockParam[]>
  // ...更多字段
}
```

注册入口：`src/skills/bundled/index.ts` → `initBundledSkills()`（line 33-80）。

### 2.2 Fork 执行机制

已验证 `src/utils/forkedAgent.ts` → `prepareForkedCommandContext()`（line 191-232）：

```
command.agent ?? 'general-purpose' → 查找 agent 定义
command.allowedTools → parseToolListFromCLI() → alwaysAllowRules
skill prompt → getPromptForCommand() → 注入为子 agent 首条消息
```

关键事实：
- `agent: 'general-purpose'` 使用内置通用 agent（`packages/builtin-tools/src/tools/AgentTool/built-in/generalPurposeAgent.ts`，agentType: `'general-purpose'`）
- `allowedTools` 通过 `createGetAppStateWithAllowedTokens()` 转为权限白名单
- 子 agent 拥有独立上下文，结果以文本形式返回到主会话

### 2.3 现有 StrictPlan Agent

已验证 `src/costrict/agents/strictPlan.ts`。当前 prompt 已有完善的"需求澄清"章节（line 61-83），包含：
- "探索驱动，基于事实" — 项目探索优先于提问
- "澄清优于假设" — 绝不在心里偷偷假设
- "需求复杂度感知提问" — 需求详尽则少问，简短则适度补充
- "代码可答则不问" — 可从代码推断的禁止提问

**缺少的**：没有"逐问题一问一答 + 推荐答案"的交互节奏约束。

### 2.4 现有 TDD Agent

已验证 `src/costrict/agents/tdd.ts`。当前 prompt 是 4 步流水线：可运行性验证 → 需求确认 → 生成测试用例 → 执行与修复。**完全没有涉及测试哲学**（行为 vs 实现、垂直 vs 水平切片）。

---

## 三、集成策略

### 策略概述

```
路径 A: 增强现有 agent prompt   → 低风险、低改动、立刻见效
路径 B: 新建 bundled skill       → 中风险、需翻译适配、填补空白
路径 C: 文件层兼容              → 零风险、零改动、但有局限
路径 D: 暂不集成                → 不适合或没有明确需求
```

---

### 路径 A — 增强现有 Agent Prompt（推荐优先执行）

不改注册逻辑，只改 prompt 文本。改动范围可控，可直接评估效果。

#### A1. 增强 `strict-test`（TDD agent）— 注入测试哲学

**当前问题**：`src/costrict/agents/tdd.ts` 的 prompt 只描述了流程（verify → confirm → generate → execute），没有教 agent 什么样的测试是好的。

**改动**：在 `getStrictTDDSystemPrompt()` 返回的 prompt 中，Step 3（生成测试用例）之前插入以下段落：

```
## 测试设计原则

在生成测试用例之前，理解以下原则：

### 行为测试 > 实现测试
- 好测试：通过公共接口验证系统"做什么"（用户可观察的行为）
- 坏测试：验证内部实现细节（私有方法调用、内部状态变更）
- 判断标准：如果重构内部实现但不改行为，测试应该继续通过

### 垂直切片 > 水平切片
- 垂直切片：一次完成一个 RED→GREEN 循环（一个测试 + 对应实现）
- 水平切片（禁止）：一次性写完所有测试，再一次性写完所有实现
- 原因：水平切片产生的测试基于"想象的行为"而非"真实的实现"

### 集成风格 > 单元 Mock 风格
- 优先使用真实依赖或轻量替代（内存 DB、临时文件）
- 仅在外部系统不可控时才使用 mock
- Mock 应模拟行为契约，而非实现细节
```

**改动范围**：`src/costrict/agents/tdd.ts`，约 20 行新增。

**风险**：低。不影响现有流程结构，仅添加前置指导。

#### A2. 微调 `strict:plan` — 明确"一问一答"节奏

**当前问题**：StrictPlan 的 prompt 已包含"澄清优于假设"等原则（line 67-83），但没有约束 Agent 必须**逐问题一问一答**。Agent 有时会一次抛出大量问题。

**改动**：在 `src/costrict/agents/strictPlan.ts` 的"需求澄清原则"段落末尾插入：

```
**提问节奏约束**：
- 每次只提一个问题，等待用户回答后再提下一个
- 每个问题附带你的推荐答案，用户可确认或修正
- 不要批量列出问题清单让用户一次性回答
```

**改动范围**：`src/costrict/agents/strictPlan.ts`，约 5 行新增。

**风险**：极低。只约束节奏，不改变逻辑。

#### A3. CONTEXT.md 加载（可选，中期）

在 `src/context.ts` 中扩展 CLAUDE.md 加载逻辑，同时检测项目根目录 `CONTEXT.md` 并将其内容追加到系统提示中。格式参考 Matt Pocock 的方案：术语表（概念名 + 定义 + 避免的同义词）。

**风险**：中。需要修改 context 构建逻辑，可能影响 prompt 长度预算。

---

### 路径 B — 新建 Bundled Skill

仅推荐一个经过充分验证价值的技能。

#### B1. `debug:diagnose`（唯一推荐新建）

**为什么只有这一个**：
- 调试是日常最高频痛点，CSC 目前完全空白
- Matt Pocock 的 6 阶段流程是成熟的、可操作的方法论
- fork 执行模型天然适合调试场景（独立上下文、工具白名单、不污染主会话）

**不推荐新建 proto / arch:improve / issue:triage 的原因**：
- `proto`：场景太窄（快速原型），多数用户用 strict:plan 覆盖
- `arch:improve`：依赖 CONTEXT.md 和 LANGUAGE.md 生态，前置条件不满足
- `issue:triage`：依赖 GitHub/Linear 集成，CSC 没有这套基础设施

**实现**：

新增 `src/costrict/skills/diagnose.ts`：

```typescript
import { registerBundledSkill } from 'src/skills/bundledSkills.js'

export function registerDiagnoseSkill(): void {
  registerBundledSkill({
    name: 'debug:diagnose',
    description:
      '结构化 Bug 诊断：构建反馈循环→复现→假设→插桩→修复→回归测试→复盘。适用于 Bug 排查和性能回归分析。',
    userInvocable: true,
    disableModelInvocation: true,
    context: 'fork',
    agent: 'general-purpose',
    allowedTools: [
      'Bash', 'Read', 'Write', 'Edit',
      'Grep', 'Glob', 'Agent(Explore)',
      'AskUserQuestion',
    ],
    async getPromptForCommand(args) {
      const bugDescription = args.trim() || '请描述你遇到的 Bug'
      return [{
        type: 'text',
        text: `## 诊断任务

用户报告的 Bug：${bugDescription}

## 诊断流程（严格按顺序执行）

### 阶段 1：构建反馈循环（最重要，投入不成比例的时间）
目标：建立一个**快速、确定性、你可独立运行**的通过/失败信号。

方法优先级（从高到低）：
1. 已有的失败测试
2. curl / CLI 脚本
3. 最小可复现的命令行调用
4. headless 浏览器脚本
5. 录制回放
6. 临时测试 harness
7. property / fuzz 循环
8. 二分搜索 harness
9. 差分对比循环
10. 人机交互 bash 脚本

对反馈循环本身进行迭代优化：提高速度、增强信号清晰度、确保确定性。
如果是非确定性 bug：目标是提高复现率，而非 100% 复现。
**如果无法构建任何反馈循环，必须立即停止并明确告知用户。**

### 阶段 2：复现
运行阶段 1 的循环，确认可以一致复现用户描述的故障模式。

### 阶段 3：假设（生成后才测试）
生成 3-5 个可证伪假设，按可能性排序。呈现给用户：
> 如果 X 是根因，那么改变 Y 应该使 bug 消失 / 改变 Z 应该使 bug 恶化

### 阶段 4：插桩
一次只改变一个变量，对照假设预测验证。
优先使用 debugger/REPL 而非日志。所有调试日志使用唯一前缀（如 \`[DEBUG-a4f2]\`）便于后续清理。

### 阶段 5：修复 + 回归测试
**先写回归测试，再修 bug。**
如果存在"正确的接缝"（可以在不改架构的前提下插测试），在此处写测试。
如果不存在，明确标记架构限制。

### 阶段 6：清理 + 复盘
- 移除所有调试代码（搜索阶段 4 的日志前缀）
- 重新运行阶段 1 的反馈循环确认通过
- 在 commit message 中写出正确的假设
- 输出简短复盘："根因：[X]。本可以更早发现，如果：[Y]。"

## 核心原则
- **反馈循环优先**：没有快速可靠的复现手段，一切诊断都是猜测
- **假设驱动**：先明确假设再做实验，避免随机尝试
- **一次一个变量**：改变多个东西导致无法归因`,
      }]
    },
  })
}
```

然后在 `src/skills/bundled/index.ts` 中注册：

```typescript
import { registerDiagnoseSkill } from 'src/costrict/skills/diagnose.js'

// 在 initBundledSkills() 中添加：
registerDiagnoseSkill()
```

**改动范围**：
- 新增：`src/costrict/skills/diagnose.ts`（~90 行）
- 修改：`src/skills/bundled/index.ts`（+2 行：import + 调用）

**为什么用 fork 而非 inline**：
- 诊断过程可能很长（构建循环、生成假设、插桩验证），不应占据主会话上下文
- fork 独立 token 预算，诊断不会侵占正常对话的 token 配额
- `allowedTools` 白名单防止诊断 agent 越权（不能删文件、不能提交代码）
- 诊断结果以文本摘要返回主会话，保持对话清晰

---

### 路径 C — 文件层兼容（零改动，有局限）

CSC 的 `src/skills/loadSkillsDir.ts` 加载 `~/.claude/skills/` 和 `.claude/skills/`。将 Matt Pocock 的技能目录放入这些位置即可被 CSC 加载。

**局限**：
- Matt Pocock 的 prompt 是英文的，CSC 的系统提示大量使用中文——混用可能导致 Agent 行为不一致
- 纯 inline 执行，不利用 fork / allowedTools / paths 条件激活
- `link-skills.sh` 使用符号链接，Windows Git Bash 下可能不是透明可用的

**适用场景**：用户在 CSC 中临时试用 Matt Pocock 的某个技能，快速验证效果。

---

### 路径 D — 暂不集成

| 技能 | 原因 |
|------|------|
| `/setup-matt-pocock-skills` | Matt Pocock 生态特定配置 |
| `/to-issues` `/to-prd` `/triage` | 依赖 Issue tracker 基础设施，CSC 未建立 |
| `/proto` | 场景窄，strict:plan 覆盖大部分原型前的设计验证需求 |
| `/arch:improve` | 依赖 CONTEXT.md + LANGUAGE.md 生态，前置条件缺失 |
| `/zoom-out` `/caveman` `/handoff` | 纯 inline prompt，路径 C 即可覆盖 |
| `/grill-me` `/write-a-skill` | CSC 已有等价物或路径 C 覆盖 |

---

## 四、推荐执行顺序

### Step 1（即刻，~30 行改动）

| 改动 | 文件 | 行数 |
|------|------|------|
| TDD agent 注入测试哲学 | `src/costrict/agents/tdd.ts` | +20 |
| StrictPlan agent 注入一问一答节奏 | `src/costrict/agents/strictPlan.ts` | +5 |

**验收方式**：运行 `/strict-test` 和 `/strict:plan`，观察 Agent 是否按照新原则行事。

### Step 2（确认 Step 1 有效后）

| 改动 | 文件 | 行数 |
|------|------|------|
| 新增 `debug:diagnose` bundled skill | `src/costrict/skills/diagnose.ts`（新） | ~90 |
| 注册到 `initBundledSkills()` | `src/skills/bundled/index.ts` | +2 |

**验收方式**：引入一个真实的 bug，运行 `/debug:diagnose`，观察 6 阶段流程是否被正确执行。

### Step 3（按需评估）

CONTEXT.md 加载机制 — 需要先观察 Step 1-2 的效果，再决定是否投入 context 构建的改动。

---

## 五、边界条件 & 风险

### B1（diagnose）的风险

1. **fork agent 可能调用过多工具**：`allowedTools` 只能控制权限（allow/deny），不能限制调用频率。如果诊断 agent 陷入循环，需要用户手动终止。
2. **prompt 长度**：~90 行的诊断 prompt 作为 fork agent 的首条消息，约占 2-3K token。在独立上下文中可接受。
3. **中文 prompt 质量**：prompt 是我从 Matt Pocock 英文版翻译的，需要在实际诊断场景中验证指令是否被正确理解。

### A1（TDD 哲学注入）的风险

1. **prompt 膨胀**：当前 TDD prompt ~115 行，新增 20 行 → ~135 行。仍在合理范围。
2. **与现有流程的冲突**：新增的"行为测试 > 实现测试"原则可能与 `@TestDesign` 子 agent 的默认行为不一致。`@TestDesign` agent（`src/costrict/agents/tddTestDesign.ts`）可能需要同步调整。

### A2（一问一答节奏）的风险

几乎为零。StrictPlan 当前 prompt 已经鼓励提问，只是没有约束节奏。

### 不做的事情 & 原因

| 不做 | 原因 |
|------|------|
| 照搬 Matt Pocock 的 SKILL.md 作为 bundled skill | 英文 prompt + CSC 中文语境 = 行为不一致 |
| 新建 arch:improve bundled skill | 依赖 CONTEXT.md / LANGUAGE.md / ADR 生态，CSC 项目自身都没建立这套文档体系 |
| 新建 proto bundled skill | CSC 的 strict:plan + SubCoding 已经覆盖"快速验证设计"的场景 |
| 新建 issue:triage bundled skill | 需要 GitHub gh CLI / Linear API 集成，超出当前范围 |
| 把 Matt Pocock 仓库整体打包为 CSC plugin | 13 个技能中约 3 个有实际价值，整体打包是噪声 |

---

## 六、总结

真正能给 CSC 用户带来价值的只有三件事：

1. **教会 TDD agent 什么是好测试**（Step 1，20 行 prompt 改动）— 直接提升测试质量
2. **让 StrictPlan agent 逐问题一问一答**（Step 1，5 行 prompt 改动）— 减少沟通误解
3. **填补调试能力空白**（Step 2，diagnose bundled skill）— 解决最高频痛点

其余技能要么已有 CSC 等价物（skillify ↔ write-a-skill、strict:plan ↔ to-prd/to-issues），要么前置条件不满足（arch:improve 需要 CONTEXT.md 生态），要么场景太窄（proto、zoom-out）。

核心原则：**吸收设计模式（审问式澄清、垂直切片、共享语言），而非搬运目录结构。**
