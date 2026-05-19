# Matt Pocock Skills 对 CSC 的集成方案

## 结论

Matt Pocock Skills 对 CSC 最有价值的部分不是把外部仓库整包搬进来，而是吸收其中一组可验证的工程工作流：

- 需求动手前先澄清，减少“Agent 没理解用户”的返工。
- 用 `CONTEXT.md` 和 ADR 沉淀项目共享语言，降低后续会话重复解释成本。
- 用 TDD 和结构化诊断形成反馈循环，保证代码真的工作。
- 用轻量架构观察帮助用户理解陌生代码，避免在不了解边界时误改。
- 用 skill 生成能力让用户把成功流程沉淀为自己的项目工具。

推荐方案是：优先增强 CSC 已有的 skill 和 CoStrict agent，再补齐少量缺口 skill；不要直接 vendor Matt Pocock 仓库，也不要一开始全局自动加载 `CONTEXT.md`。

## 已核实的 CSC 基础

以下结论基于当前仓库代码，而不是推测：

| 能力 | 当前状态 | 关键位置 |
| --- | --- | --- |
| Bundled skill 注册 | 已支持 `name`、`description`、`whenToUse`、`allowedTools`、`context`、`agent`、附加文件等 | `src/skills/bundledSkills.ts` |
| Bundled skill 入口 | 启动时注册内置 skills，包括 CoStrict skills 和 `skillify` | `src/skills/bundled/index.ts` |
| 项目/用户 skills | 支持 `.claude/skills/<name>/SKILL.md` 和 `~/.claude/skills/<name>/SKILL.md` | `src/skills/loadSkillsDir.ts` |
| Skill frontmatter | 支持 `description`、`when_to_use`、`allowed-tools`、`argument-hint`、`arguments`、`context: fork`、`agent`、`paths` 等 | `src/skills/loadSkillsDir.ts` |
| Plugin skills | 支持插件根目录 `skills/`，也支持 `.claude-plugin/plugin.json` 的 `skills` 路径 | `src/utils/plugins/pluginLoader.ts`、`src/utils/plugins/loadPluginCommands.ts` |
| SkillTool 模型调用 | 只收集 `disableModelInvocation !== true` 的 prompt command | `src/commands.ts` |
| `skillify` | 已能访谈用户并生成 `SKILL.md`，但当前只在 `USER_TYPE=ant` 时注册 | `src/skills/bundled/skillify.ts` |
| 现有需求澄清 | `strict:plan` 已有探索优先、澄清优先原则，但缺少稳定的“一轮少量高价值问题”节奏 | `src/costrict/agents/strictPlan.ts` |
| 现有测试流 | `strict-test` 已有验证、确认需求、生成测试、执行修复流程，但测试设计原则仍可加强 | `src/costrict/agents/tdd.ts`、`src/costrict/agents/tddTestDesign.ts` |

一个重要约束：当前 `strict:plan`、`strict:spec`、`strict-test`、`strict-project-wiki` 都设置了 `disableModelInvocation: true`，因此它们是用户手动调用的 slash command，不会被 `SkillTool` 自动调用。仅修改 `whenToUse` 能改善 `/skills`、slash command 说明和未来开放模型调用后的匹配质量，但不会让模型当前自动调用它们。

## 集成原则

1. **吸收方法，不搬运目录**  
   Matt Pocock 的原始 skills 包含个人偏好、Issue tracker 约定、英文 prompt 和安装脚本。直接搬运会增加默认技能噪声，也不一定符合 CSC 的中文体验、权限模型和 CoStrict 编排方式。

2. **大流程先手动，低风险能力再自动**  
   `strict:plan`、`strict-test`、`grill-with-docs` 这类会写文件或启动子 agent 的流程，初期应保持用户手动调用。`zoom-out` 这类只读理解型 skill 验证稳定后可以考虑开放模型自动调用。

3. **不把 `CONTEXT.md` 默认塞进每轮上下文**  
   直接全局加载会增加 token 成本，并可能因陈旧内容污染判断。初期应由相关 skill 显式读取和维护；等内容质量稳定后，再考虑摘要化或按路径触发加载。

4. **每个新增 skill 必须有验收信号**  
   方案不应只增加 prompt。每个 skill 都要明确用户价值、使用边界、工具权限、成功产物和验证方式。

## Matt Pocock Skills 映射

| Matt Skill / 模式 | CSC 处理建议 | 原因 |
| --- | --- | --- |
| `/grill-me` | 不单独集成；保留项目级 `interview` 或并入 `/grill-with-docs` | CSC 已有 `.claude/skills/interview/SKILL.md`，但工程化沉淀不足 |
| `/grill-with-docs` | 新增 CSC 原生 bundled skill | 补齐“需求澄清 + 共享语言/ADR 沉淀”闭环 |
| `/tdd` | 增强现有 `strict-test` 和 `TestDesign` prompt | CSC 已有测试编排，低成本增强测试哲学即可产生价值 |
| `/diagnose` | 新增 CSC 原生 bundled skill | 当前缺少独立、可复现、可回归的 bug 诊断入口 |
| `/zoom-out` | 新增只读 bundled skill，优先级低于 diagnose | 对理解陌生代码有价值，风险低 |
| `/write-a-skill` | 开放并增强现有 `/skillify` | CSC 已有实现，只需去掉内部用户限制并补强模板 |
| `/to-prd`、`/to-issues`、`/triage` | 暂不集成 | 依赖 GitHub/Linear/本地 issue tracker 抽象，当前收益不如基础工程流 |
| `/prototype` | 暂不作为默认内置 | 场景较窄，可先由 `strict:plan` 覆盖设计验证 |
| `/improve-codebase-architecture` | 暂缓 | 依赖稳定的 `CONTEXT.md`、ADR 和共享语言生态 |
| `/handoff`、`/caveman` | 可作为用户级可选 skill，不进默认 bundled | 通用但非 CSC 核心价值，容易增加默认列表噪声 |
| `/setup-pre-commit`、`/git-guardrails-claude-code` | 暂不集成默认能力 | 涉及 hooks 和本地策略，适合作为插件或文档方案 |

## 推荐路线

### Phase 1：修正并增强现有 CoStrict skills

目标：让 CSC 已有工程流程更容易被用户理解、选择和复用。

改动范围：

- `src/costrict/skills/strictPlan.ts`
- `src/costrict/skills/strictSpec.ts`
- `src/costrict/skills/tdd.ts`
- `src/costrict/skills/projectWiki.ts`
- `src/costrict/agents/strictPlan.ts`
- `src/costrict/agents/tdd.ts`
- `src/costrict/agents/tddTestDesign.ts`

建议改动：

1. 为四个 CoStrict skill 补齐清晰中文 `description` 和 `whenToUse`。  
   注意：保留 `disableModelInvocation: true`，先不让模型自动调用这些大流程。

2. 在 `strict:plan` agent 的需求澄清原则中加入提问节奏：
   - 每轮只问 1 到 3 个高价值问题。
   - 每个问题必须说明为什么影响实现决策。
   - 不批量抛出长问题清单。
   - 能从代码、配置、现有文档推断的内容不要问用户。

3. 在 `strict-test` 和 `TestDesign` 中补充测试设计原则：
   - 行为测试优先于实现细节测试。
   - 垂直切片优先于一次性水平铺开。
   - 优先集成测试，只有外部系统不可控时才 mock。
   - 先形成失败信号，再修复或补实现。

用户价值：

- 用户更容易知道该用哪个 CSC 工作流。
- 需求澄清更像高质量访谈，而不是一次性问卷。
- 测试输出更关注真实行为，减少脆弱 mock 和实现细节绑定。

验收方式：

- `bun run typecheck` 通过。
- `/skills` 中相关描述清晰、无乱码、无中英混杂的生硬描述。
- 对一个模糊需求调用 `/strict:plan`，观察是否先探索项目，再提出少量关键问题。
- 对一个功能改动调用 `/strict-test`，观察测试方案是否围绕行为和可回归信号设计。

### Phase 2：开放并增强 `/skillify`

目标：让用户把一次成功的协作流程沉淀成可复用 skill。

当前状态：

- `src/skills/bundled/skillify.ts` 已经具备会话分析、用户访谈和 `SKILL.md` 生成能力。
- `registerSkillifySkill()` 当前被 `process.env.USER_TYPE !== 'ant'` 限制。

建议改动：

1. 移除或放宽 `USER_TYPE=ant` 限制。  
   如需灰度，可增加显式运行时开关，例如 `CSC_SKILLIFY_ENABLED=1`，但不应继续绑定内部用户身份。

2. 保留写入前确认，不做静默写文件。

3. 生成模板必须强调：
   - `description` 和 `when_to_use` 必须具体，包含触发短语示例。
   - `allowed-tools` 使用最小权限，不默认给宽泛 `Bash`。
   - `context: fork` 只用于自包含、不需要中途问用户的任务。
   - 每个步骤都有成功标准。
   - 包含验证命令或验收方式。

4. 默认保存策略：
   - 项目专属流程：`.claude/skills/<name>/SKILL.md`
   - 跨项目个人流程：`~/.claude/skills/<name>/SKILL.md`

用户价值：

- 用户不需要学习完整 skill 规范，也能沉淀团队流程。
- 高频流程可以从聊天经验变成可复用工具。
- CSC 的能力从“固定内置”扩展为“用户可训练的工作流系统”。

验收方式：

- 普通用户环境下能看到并调用 `/skillify`。
- 生成的 skill 能被 `/skills` 列出。
- 生成的 `SKILL.md` frontmatter 符合 `loadSkillsDir.ts` 支持的字段。

### Phase 3：新增 `/grill-with-docs`

目标：把需求澄清和项目共享语言沉淀连接起来。

推荐形态：

- 文件：`src/skills/bundled/grillWithDocs.ts`
- 注册入口：`src/skills/bundled/index.ts`
- 初期：`userInvocable: true`，`disableModelInvocation: true`
- 执行上下文：`inline`
- 建议工具：`AskUserQuestion`、`Read`、`Glob`、`Grep`、`Write`、`Edit`

为什么用 `inline`：

- 该流程需要持续和用户互动。
- 写入 `CONTEXT.md` 或 ADR 前需要用户确认。
- fork 更适合自包含任务，不适合多轮需求访谈。

行为契约：

1. 先读取用户需求和相关代码/文档，不能直接开始写方案。
2. 每轮只问 1 到 3 个高价值问题。
3. 问题必须具体，并给出推荐选项。
4. 能从项目中确认的问题，不问用户。
5. 澄清结束后输出：
   - 需求摘要
   - 非目标
   - 约束
   - 验收标准
   - 风险和开放问题
6. 只有当信息具有长期价值时，才建议更新 `CONTEXT.md`。
7. 只有当涉及架构取舍时，才建议新增 ADR。
8. 写入 `CONTEXT.md` 或 ADR 前必须让用户确认。

用户价值：

- 模糊需求会先被澄清，而不是直接进入实现。
- 长期术语、模块边界和架构决策被留下来，后续会话可复用。
- 团队可以 review 需求澄清产物，而不只是 review 最终代码。

验收方式：

- 对一句模糊需求调用 `/grill-with-docs`，它应先探索和提问，而不是直接编码。
- 对一次明确的小改动调用时，它应少问或不问无意义问题。
- 只有长期有效的信息会进入 `CONTEXT.md`。

### Phase 4：新增 `/diagnose`

目标：把 bug 修复从“猜测式改代码”变成可复现、可回归的诊断循环。

推荐形态：

- 文件：`src/skills/bundled/diagnose.ts` 或 `src/costrict/skills/diagnose.ts`
- 注册入口：`src/skills/bundled/index.ts`
- 初期：`userInvocable: true`，`disableModelInvocation: true`
- 执行上下文：默认 `context: fork`；如果缺少复现信息，先返回主会话要求用户补充
- Agent：可先使用 `general-purpose`；稳定后再考虑专用 `Diagnose` agent

工作流：

1. 明确症状、期望行为、实际行为。
2. 构建最快、最稳定的反馈循环：
   - 已有失败测试
   - 最小测试命令
   - CLI/curl 复现
   - 临时 harness
   - 二分或差分对比
3. 确认故障可以复现。
4. 提出 1 到 3 个可证伪假设。
5. 一次只验证一个变量。
6. 需要插桩时使用唯一前缀，修复后必须清理。
7. 先补回归测试，再修复代码。
8. 最后输出根因、修复内容、回归验证和防复发建议。

工具权限建议：

- 初期不要宽泛自动允许 `Bash`。
- 对 CSC 自身可窄化允许 `Bash(bun test:*)`、`Bash(bun run typecheck)` 等。
- 对通用用户项目，允许 shell 但通过权限确认，由 prompt 要求优先使用项目已知测试命令。

用户价值：

- 每个 bug 修复都有复现证据和回归保护。
- 减少“修了表象，根因仍在”的情况。
- 长诊断过程放在 fork 中执行，主会话保持清晰。

验收方式：

- 用一个已有失败测试触发 `/diagnose`。
- 最终输出必须包含：复现方式、假设验证、根因、修复、回归测试。
- 检查工作区没有残留临时日志或插桩代码。

### Phase 5：新增 `/zoom-out`

目标：给用户一个低成本理解陌生代码的入口。

推荐形态：

- 文件：`src/skills/bundled/zoomOut.ts`
- 初期可手动调用；验证稳定后可考虑 `disableModelInvocation: false`
- 执行上下文：`fork`
- 工具权限：只读，建议 `Read`、`Glob`、`Grep`、必要时 `Agent(QuickExplore)`

行为契约：

1. 读取用户指定文件、目录或最近变更。
2. 说明这段代码在系统中的位置。
3. 识别入口、出口、核心数据结构和依赖方向。
4. 标出隐含约束、易误改点和需要先确认的边界。
5. 可以给小而可验证的改进建议。
6. 不直接重构，除非用户明确要求。

用户价值：

- 新成员更快理解代码。
- review 前先建立系统视角。
- 降低“为了理解代码而过度重构”的风险。

验收方式：

- 对 `src/commands.ts` 或 `src/skills/loadSkillsDir.ts` 调用。
- 输出应是系统边界和依赖解释，而不是逐行复述。
- 不应产生任何文件修改。

## `CONTEXT.md` 与 ADR 契约

建议新增根目录 `CONTEXT.md`，但不替代 `CLAUDE.md`。

职责划分：

| 文件 | 职责 |
| --- | --- |
| `CLAUDE.md` | Agent 行为规范、仓库命令、架构索引、协作规则 |
| `CONTEXT.md` | 长期有效的项目共享语言、领域术语、模块边界、命名约定、状态机 |
| `docs/adr/*.md` | 重要且不应轻易改变的架构决策 |

推荐模板：

```markdown
# CONTEXT.md

## Terms

- Term: Meaning in this project.

## Module Boundaries

- Module A owns ...
- Module B must not ...

## Workflows

- Requirement clarification:
- Testing:
- Release:

## Decisions Worth Remembering

- YYYY-MM-DD: Short decision summary. See docs/adr/...
```

写入规则：

- 只写长期有效的信息。
- 不记录一次性任务细节。
- 不记录聊天中的临时偏好，除非它长期影响项目工作流。
- 更新前必须向用户展示 diff 或摘要并确认。
- 如果只是一次实现方案，放到 `.cospec/plan/changes/` 或任务文档，不写入 `CONTEXT.md`。

ADR 模板：

```markdown
# ADR: <decision title>

- Date: YYYY-MM-DD
- Status: accepted | superseded | proposed

## Context

What situation forced this decision?

## Decision

What did we choose?

## Consequences

- Positive:
- Negative:
- Follow-up:
```

## 最小可行版本

如果只做一个小版本，推荐范围如下：

1. 增强 `strict:plan` 的提问节奏。
2. 增强 `strict-test` / `TestDesign` 的测试设计原则。
3. 放开并增强 `/skillify`。
4. 新增手动调用的 `/grill-with-docs`。

这四项能形成最短闭环：

```text
澄清需求 -> 沉淀共享语言 -> 实施/测试 -> 把成功流程 skillify
```

暂不把大流程开放给模型自动调用，避免误触发长任务或文件写入。

## 成功指标

可以用以下指标判断集成是否真的对用户有价值：

- 用户在模糊需求上更少返工。
- `/strict:plan` 的澄清问题数量减少但质量提高。
- `/strict-test` 生成的测试更关注行为和回归保护。
- bug 修复输出稳定包含复现方式、根因和回归验证。
- 项目中出现可维护的 `CONTEXT.md` 和 ADR，而不是只存在聊天记录里。
- 普通用户能用 `/skillify` 创建自己的项目 workflow。
- `bun run typecheck` 始终通过。

## 不建议立即做的事情

- 不要直接把 Matt Pocock Skills 仓库整体打包为 CSC 默认插件。
- 不要把 `CONTEXT.md` 自动注入每轮上下文。
- 不要让 `strict:plan`、`strict-test` 这类大流程一开始就自动被模型调用。
- 不要在没有 issue tracker 抽象的情况下实现 `/to-issues`、`/triage`。
- 不要为了“架构改进”先做大规模重构型 skill；先做只读 `/zoom-out`。

## 实施顺序总览

| 优先级 | 工作项 | 价值 | 风险 |
| --- | --- | --- | --- |
| P0 | 修正 CoStrict skill 描述和 prompt 节奏 | 立刻改善现有体验 | 低 |
| P0 | 开放 `/skillify` | 用户可沉淀自己的流程 | 低 |
| P1 | 新增 `/grill-with-docs` | 减少需求误解并沉淀上下文 | 中 |
| P1 | 新增 `/diagnose` | 提升 bug 修复可靠性 | 中 |
| P2 | 新增 `/zoom-out` | 降低理解陌生代码成本 | 低 |
| P3 | 考虑插件化或 marketplace 分发 | 便于独立演进 | 中 |

最终目标不是让 CSC 的 skill 列表变长，而是让用户更少解释、更少返工、更容易验证结果，并能把自己的有效流程变成可复用资产。
