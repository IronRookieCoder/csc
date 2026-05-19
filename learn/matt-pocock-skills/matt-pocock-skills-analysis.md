# Matt Pocock Skills 仓库分析 & CSC 集成方案

D:\third\skills 是 **Matt Pocock**（TypeScript 知名讲师）维护的一套 Claude Code / 编程 Agent 使用的技能（slash commands）。核心理念是把传统软件工程的最佳实践注入 AI 辅助开发流程——不是"氛围编程"（vibe coding），而是**真正的工程化**。

---

## 一、目录结构

```
skills/
├── engineering/     # 日常开发技能（10 个）
├── productivity/    # 通用工作流技能（4 个）
├── misc/            # 偶尔用到的工具（4 个）
├── personal/        # 作者个人配置（2 个），不推广
├── in-progress/     # 开发中的草稿（4 个）
└── deprecated/      # 已弃用（4 个）
```

技能通过 `.claude-plugin/plugin.json` 注册（当前注册 18 个：engineering 10 + productivity 4 + misc 4），`scripts/link-skills.sh` 用符号链接安装到 `~/.claude/skills/`。CSC 已有的 `src/skills/loadSkillsDir.ts` 原生支持从 `.claude/skills/` 加载 SKILL.md，这意味着 Matt Pocock 的技能**在文件层面已经兼容 CSC**。

---

## 二、核心设计理念：四个失败模式 + 解决方案

### 问题 1：Agent 没理解你想要什么
→ **grilling session**（审问式对话）。技能 `/grill-me` / `/grill-with-docs` 让 Agent 一步步追问，穷尽设计分支。

### 问题 2：Agent 输出太啰嗦
→ **共享语言**（shared language）。`CONTEXT.md` 建立项目术语表，Agent 用领域语言交流，减少 token 消耗。

### 问题 3：代码不工作
→ **反馈循环**。`/tdd`（红-绿-重构，垂直切片）+ `/diagnose`（6 阶段结构化调试：复现→最小化→假设→插桩→修复→回归）。

### 问题 4：代码变成泥球
→ **日常设计投入**。`/improve-codebase-architecture`（深模块改进）+ `/zoom-out`（系统视角）+ `/to-prd`（模块感知的 PRD）。

---

## 三、技能速览

### Engineering（10 个）— 日常编码技能

| 技能 | 用途 |
|------|------|
| `/setup-matt-pocock-skills` | 一次性仓库配置（issue tracker 选择、triage 标签词汇表、领域文档布局），其他 engineering 技能的前置依赖 |
| `/grill-with-docs` | 审问式需求澄清 + 同步更新 CONTEXT.md 和 ADR |
| `/tdd` | 红-绿-重构测试驱动开发，垂直切片推进 |
| `/diagnose` | 6 阶段结构化 Bug 诊断循环（复现→最小化→假设→插桩→修复→回归） |
| `/triage` | Issue 状态机分类（通过 triage role 标签驱动） |
| `/to-issues` | 将计划/PRD 按垂直切片拆成独立可认领的 Issues（支持 GitHub/Linear/本地文件） |
| `/to-prd` | 从对话上下文直接合成 PRD 提交为 Issue（无面试环节） |
| `/zoom-out` | 对陌生代码段给出系统级高层视角 |
| `/prototype` | 搭建可丢弃的原型验证设计——控制台应用（验证状态/逻辑）或多种 UI 变体（同路由切换） |
| `/improve-codebase-architecture` | 基于 CONTEXT.md 领域语言和 ADR 决策记录，系统化寻找深模块改进机会 |

### Productivity（4 个）— 通用工作流技能

| 技能 | 用途 |
|------|------|
| `/grill-me` | 审问式需求澄清，不涉及文档更新（非代码场景） |
| `/caveman` | 极致压缩的沟通模式，去除填充词但保持完整技术准确性，省 ~75% token |
| `/handoff` | 将当前会话压缩为交接文档，供另一个 Agent 继续工作 |
| `/write-a-skill` | 创建新 skill 的引导流程（规范结构、渐进式披露、附带资源） |

### Misc（4 个）— 偶尔使用的工具

| 技能 | 用途 |
|------|------|
| `/git-guardrails-claude-code` | 设置 Claude Code PreToolUse hook，拦截危险 git 命令（push、reset --hard、clean、branch -D 等） |
| `/migrate-to-shoehorn` | 将测试文件中的 `as` 类型断言迁移为 @total-typescript/shoehorn |
| `/scaffold-exercises` | 创建练习目录结构（含 sections、problems、solutions、explainers） |
| `/setup-pre-commit` | 设置 Husky pre-commit hooks（lint-staged + Prettier + 类型检查 + 测试） |

### In-Progress（4 个）— 开发中的草稿

| 技能 | 用途 |
|------|------|
| `/review` | 双轴审查：Standards（是否符合编码规范）和 Spec（是否忠实实现原始 issue/PRD） |
| `/writing-beats` | 将文章塑形为节拍旅程，选择一个起始节拍，写完再转向下一个 |
| `/writing-fragments` | 审问式挖掘写作片段，追加到单一文档作为未来文章的原材料 |
| `/writing-shape` | 将原始 markdown 文件逐步塑形为文章，每步论证格式选择 |

### Deprecated（4 个）— 已弃用

`design-an-interface`、`qa`、`request-refactor-plan`、`ubiquitous-language`（`ubiquitous-language` 的共享语言功能已整合到 `/grill-with-docs` 中）。

### Personal（2 个）— 作者个人使用

`edit-article`、`obsidian-vault`。

---

## 四、Skill 内部文档结构

每个 skill 不仅是单个 SKILL.md，还附带了按需加载的参考文档（progressive disclosure）：

| Skill | 附带文档 |
|-------|----------|
| `/tdd` | `deep-modules.md`、`interface-design.md`、`mocking.md`、`refactoring.md`、`tests.md` |
| `/improve-codebase-architecture` | `DEEPENING.md`、`INTERFACE-DESIGN.md`、`LANGUAGE.md` |
| `/prototype` | `LOGIC.md`（控制台原型）、`UI.md`（UI 变体） |
| `/grill-with-docs` | `ADR-FORMAT.md`、`CONTEXT-FORMAT.md` |
| `/triage` | `AGENT-BRIEF.md`、`OUT-OF-SCOPE.md` |
| `/setup-matt-pocock-skills` | `domain.md`、`issue-tracker-github.md`、`issue-tracker-gitlab.md`、`issue-tracker-local.md`、`triage-labels.md` |

---

## 五、CSC 集成注意事项

1. **plugin.json 格式**：CSC 目前从 `~/.claude/skills/` 加载 SKILL.md，但 Matt Pocock 用 `.claude-plugin/plugin.json` 管理技能注册。如果要完整兼容，CSC 需要支持 plugin.json 格式或提供等效的批量注册机制。

2. **CONTEXT.md 范式**：Matt Pocock 的核心创新——用 `CONTEXT.md` 建立项目共享语言——不依赖任何特殊机制，Agent 通过 `/grill-with-docs` 自然维护它。CSC 已有的 `CLAUDE.md` 加载机制可以承担类似角色，但 CONTEXT.md 更聚焦领域术语而非项目指南。

3. **脚本依赖**：`git-guardrails-claude-code` 和 `setup-pre-commit` 两个 skill 涉及 hook 和脚本文件，CSC 需要确保 hook 执行环境和脚本路径兼容。

4. **Issue Tracker 抽象层**：多个 engineering skill（`to-issues`、`to-prd`、`triage`）依赖 issue tracker 的抽象——通过 `setup-matt-pocock-skills` 配置 GitHub/Linear/本地文件三种后端。这个抽象层是这些 skill 的核心基础设施。
