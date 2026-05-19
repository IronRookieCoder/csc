# Matt Pocock Skills 对 CSC 的集成方案

## 结论

Matt Pocock skills 仓库最值得 CSC 吸收的不是某几个 slash command 名称，而是一套把 AI 辅助开发工程化的产品方法：

1. 在动手前澄清需求，减少误解。
2. 用项目共享语言降低反复解释成本。
3. 用可验证的反馈循环保证代码真的工作。
4. 用持续的小型架构审视避免代码劣化。

CSC 已经具备承载这些能力的基础设施：`SKILL.md` 加载、项目/用户/bundled/plugin skills、`SkillTool`、`DiscoverSkills`、动态 skill 发现、agent frontmatter preload、以及 skill-learning。集成重点应该是补齐高质量默认工作流，而不是重写 skill 系统或直接搬运外部仓库。

## 当前 CSC 的可用基础

### 已有能力

- 项目级 skills：`.claude/skills/<name>/SKILL.md`。
- 用户级 skills：`~/.claude/skills/<name>/SKILL.md`。
- bundled skills：通过 `src/skills/bundledSkills.ts` 的 `registerBundledSkill()` 注册。
- 插件 skills：通过 `.claude-plugin/plugin.json` 和 `src/utils/plugins/loadPluginCommands.ts` 加载。
- SkillTool 自动暴露：`src/commands.ts` 中 `getSkillToolCommands()` 会把可由模型调用的 prompt command 汇总给 `SkillTool`。
- `when_to_use` / `description` 支持：文件型 skill 通过 `src/skills/loadSkillsDir.ts` 解析；bundled skill 用 `whenToUse` 字段。
- 动态发现：读取/编辑文件时可激活路径相关 skills。
- 现有相关 skills：
  - `.claude/skills/interview/SKILL.md`
  - `.claude/skills/teach-me/SKILL.md`
  - `src/costrict/skills/strictPlan.ts`
  - `src/costrict/skills/strictSpec.ts`
  - `src/costrict/skills/projectWiki.ts`
  - `src/costrict/skills/tdd.ts`
  - `src/skills/bundled/skillify.ts`

### 主要缺口

1. 现有 CoStrict bundled skills 的 `description` / `whenToUse` 有乱码，且表达不够利于自动匹配。
2. `/skillify` 已经接近 Matt 的 `/write-a-skill`，但目前只对 `USER_TYPE=ant` 注册，普通用户无法受益。
3. 当前有 `interview`，但还没有能稳定产出 `CONTEXT.md` 和 ADR 的工程版需求澄清流程。
4. 当前有 `strict-test`，但缺少独立的结构化 bug 诊断 skill。
5. 架构审视能力分散在 plan/wiki/review 中，缺少轻量、日常可用的 `/zoom-out` 或 `/architecture-review`。

## 不建议做的事

### 不建议直接 vendor Matt skills 仓库

原因：

- 外部仓库的 issue tracker、个人配置、标签体系和 CSC 不一定一致。
- 直接导入会增加默认 skill 列表噪声，降低 SkillTool 匹配质量。
- CSC 已经有插件和 skill 加载管线，重复安装脚本价值低。
- 外部 prompt 未必符合 CSC 的工具权限、中文用户体验、CoStrict agent 编排方式。

更好的做法是吸收工作流设计，把它们重写为 CSC 原生 bundled/project skills。

### 不建议一开始全局自动加载 `CONTEXT.md`

原因：

- 会增加每轮 token 成本。
- 旧内容或低质量内容可能污染模型判断。
- CSC 已经有 `CLAUDE.md` 作为常驻上下文入口。

更好的做法是先让相关 skills 显式读写 `CONTEXT.md`，等质量稳定后再考虑按需摘要或路径触发加载。

## 推荐集成路线

## Phase 1：修正现有 skills，让自动匹配先可用

目标：让用户不需要记住复杂命令，模型也能准确选择已有工程 workflow。

改动：

1. 修复以下文件中的乱码和触发描述：
   - `src/costrict/skills/strictPlan.ts`
   - `src/costrict/skills/strictSpec.ts`
   - `src/costrict/skills/projectWiki.ts`
   - `src/costrict/skills/tdd.ts`
2. 为每个 bundled skill 补充清晰的 `whenToUse`：
   - `strict:plan`：需求较大、需要先探索代码并形成实施计划时使用。
   - `strict:spec`：需要将需求拆成 requirement/design/task/coding 阶段时使用。
   - `strict-project-wiki`：需要生成或刷新项目技术文档体系时使用。
   - `strict-test`：需要按需求设计测试、运行测试、修复失败并回归验证时使用。
3. 确保 `allowedTools` 最小化且真实覆盖流程，不使用宽泛权限。

用户价值：

- 新用户不需要理解 CSC 内部 agent 名称。
- 模型能在合适时自动调用 skill，而不是给出一段泛泛建议。
- 已有能力立刻变得可发现、可复用。

验证方式：

- `bun run typecheck`
- 启动 CLI 后执行 `/skills`，确认描述无乱码。
- 用自然语言请求触发对应 skill，例如“帮我先澄清需求并制定实现计划”。

## Phase 2：开放并增强 `/skillify`

目标：让用户把一次成功的协作流程沉淀成可复用 skill。

当前状态：

- `src/skills/bundled/skillify.ts` 已经能分析会话、访谈用户、生成 `SKILL.md`。
- 但 `registerSkillifySkill()` 中存在 `process.env.USER_TYPE !== 'ant'` 的注册限制。

建议改动：

1. 移除或放宽 `USER_TYPE=ant` 限制，让普通 CSC 用户可用。
2. 保留用户确认步骤，不自动静默写入 skill。
3. 生成模板中强化 CSC 标准：
   - `description`
   - `when_to_use`
   - `allowed-tools`
   - `argument-hint`
   - `arguments`
   - `context: fork` 仅用于自包含任务
   - 每个步骤必须有成功标准
   - 明确验证命令或验收方式
4. 默认保存位置：
   - 项目专属流程：`.claude/skills/<name>/SKILL.md`
   - 跨项目个人流程：`~/.claude/skills/<name>/SKILL.md`

用户价值：

- 用户不用学习 `SKILL.md` 规范，也能把团队流程变成工具。
- 高频流程会越用越稳定，减少重复解释。
- CSC 从“内置固定能力”变成“可被用户训练的工作流系统”。

验证方式：

- 执行 `/skillify <流程描述>`。
- 确认生成的 `SKILL.md` 可被 `/skills` 列出。
- 用自然语言触发该 workflow，确认 SkillTool 能匹配。

## Phase 3：新增 `/grill-with-docs`

目标：把需求澄清和项目共享语言沉淀连接起来。

建议实现形态：

- 作为 bundled skill：`src/skills/bundled/grillWithDocs.ts`。
- 注册名：`grill-with-docs`。
- 用户可手动调用，也允许模型自动调用。
- 优先用 inline context，因为该流程需要持续询问用户。

行为要求：

1. 先探索项目结构和相关文件。
2. 每轮只问 1 到 3 个高价值问题。
3. 问题必须具体，避免显而易见的问题。
4. 澄清结束后产出：
   - 需求摘要
   - 非目标
   - 约束
   - 验收标准
   - 风险和开放问题
5. 如果涉及新的长期术语、模块边界或业务概念，更新 `CONTEXT.md`。
6. 如果涉及架构取舍，新增 `docs/adr/YYYY-MM-DD-<slug>.md`。
7. 写入文档前要给用户确认。

用户价值：

- 减少“Agent 没理解我”的失败。
- 需求和约定被留下来，后续会话不必重讲。
- 团队可以 review 需求澄清产物，而不是只 review 最终代码。

验证方式：

- 对一个模糊需求调用 `/grill-with-docs`。
- 检查是否先提问而不是直接编码。
- 检查是否只在有长期价值时更新 `CONTEXT.md` 或 ADR。

## Phase 4：新增 `/diagnose`

目标：把 bug 修复从“猜测式改代码”变成可复现、可回归的调试循环。

建议实现形态：

- 作为 bundled skill：`src/skills/bundled/diagnose.ts`。
- 注册名：`diagnose`。
- 可考虑 `context: fork`，但当需要用户提供环境信息时应保持 inline。

工作流：

1. 收集症状、期望行为、实际行为。
2. 找到最小复现方式。
3. 运行或创建失败测试。
4. 提出 1 到 3 个假设。
5. 添加最小必要插桩或日志。
6. 修复根因。
7. 运行回归测试。
8. 总结根因和防止复发措施。

用户价值：

- 减少“修了一个表象，留下根因”的情况。
- 每个 bug 修复都带有可复现证据和回归保护。
- 适合交给子 agent 独立执行，降低主会话负担。

验证方式：

- 用一个已知失败测试或可复现 bug 触发。
- 确认最终输出包含复现、根因、修复、回归验证。

## Phase 5：新增 `/zoom-out` 或 `/architecture-review`

目标：给用户一个低成本理解陌生代码和发现架构问题的入口。

建议优先做 `/zoom-out`，因为它比大规模 architecture review 更日常。

行为要求：

1. 读取用户指定文件、目录或最近变更。
2. 解释该代码在系统中的位置。
3. 识别入口、出口、核心数据结构、依赖方向。
4. 标出隐含约束和容易误改的地方。
5. 如果发现架构问题，只给小而可验证的改进建议。
6. 不直接重构，除非用户明确要求。

用户价值：

- 新成员上手更快。
- 代码 review 前能先建立系统视角。
- 避免为了“理解代码”而触发过大的重构。

验证方式：

- 对 `src/commands.ts` 或 `src/skills/loadSkillsDir.ts` 调用。
- 输出应帮助理解系统边界，而不是逐行复述。

## 建议的 `CONTEXT.md` 契约

建议在项目根目录使用 `CONTEXT.md` 存放共享语言，而不是替代 `CLAUDE.md`。

职责划分：

- `CLAUDE.md`：Agent 行为规范、命令、架构索引、仓库注意事项。
- `CONTEXT.md`：领域术语、项目概念、模块边界、命名约定、状态机。
- `docs/adr/*.md`：不可轻易改变的架构决策。

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
- 不记录用户临时偏好，除非它会长期影响项目工作流。
- 更新前给用户确认。

## 推荐优先级

1. 修复现有 CoStrict skills 的乱码、描述和 `whenToUse`。
2. 开放并增强 `/skillify`。
3. 新增 `/grill-with-docs`。
4. 新增 `/diagnose`。
5. 新增 `/zoom-out`。
6. 再考虑将这些打包成内置插件或 marketplace 条目。

这个顺序的原因是：前两步复用现有代码最多、风险最低、用户收益最快；后续新增 skills 都可以用前两步稳定后的规范实现。

## 成功指标

可以用以下指标判断集成是否真的有价值：

- 用户更少手动指定 workflow，模型能自动选中正确 skill。
- 需求澄清后的返工减少。
- bug 修复输出中稳定包含复现和回归验证。
- 项目中出现可维护的 `CONTEXT.md` 和 ADR，而不是散落在聊天记录里。
- 用户开始通过 `/skillify` 创建自己的项目流程。
- `bun run typecheck` 始终通过。

## 最小可行改动

如果只做一个小版本，建议范围控制为：

1. 修复四个 CoStrict bundled skills 的乱码和 `whenToUse`。
2. 放开 `/skillify` 给普通用户。
3. 新增 `grill-with-docs` 一个 bundled skill。

这三个改动可以形成闭环：用户先澄清需求并沉淀上下文，再把成功流程转成 skill，最后由 CSC 的 SkillTool 在后续任务中自动复用。

