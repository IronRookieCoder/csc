# CSC 工程流程宏观优化分析

> 基于 CSC 代码库深度分析 + 2026 年 AI Coding 领域最佳实践对标

---

## 一、现状全景

CSC 存在 **三套工程流程体系**，服务于不同场景：

| 体系 | 入口 | 核心机制 | 适用场景 |
|------|------|---------|---------|
| 原生 Plan Mode | EnterPlanMode/ExitPlanModeV2 | 5-Phase Workflow → 审批 → 实施 → Verification Agent | 通用，需用户审批 |
| CoStrict agents/ | StrictPlan / StrictSpec Agent | 多 Agent 协作 (L0→L1)，五要素 task.md | 复杂项目，结构化需求 |
| 原生 Task/Swarm | TaskCreate + TeamCreate + SendMessage | JSON 持久化 + proper-lockfile 并发 + 多后端 | 多 Agent 并行协作 |

此外还有 `src/costrict/backup/` 中的旧版 Agent（已废弃但未删除）和 `WORKFLOW_SCRIPTS` feature flag 控制的工作流脚本（`.claude/workflows/` YAML/MD）。

### 1.1 原生 Plan Mode

**生命周期**: EnterPlanMode → 5-Phase Workflow (Explore→Design→Review→Final Plan→Exit) → ExitPlanModeV2 审批 → 实施 → Verification Agent

**核心机制**:

- **Plan 文件**: `~/.claude/plans/{word-slug}.md`，支持 session resume 恢复 + fork 复制
- **Plan Mode Attachment**: 每 5 个 human turn 动态注入一次 plan_mode 指令；第 1、6、11... 次 attachment 为完整 5-Phase 流程，其余为 sparse 简要提醒。Re-entry 检测后 reset 计数
- **PewterLedger 实验**: GrowthBook `tengu_pewter_ledger` flag，A/B 测试 4 个 arm (control/trim/cut/cap)，探索 plan 文件最优结构
- **审批 UI**: ExitPlanModeV2 提供多种审批选项：clear-context（+ auto/bypass/acceptEdits）、keep-context（+ auto/bypass/acceptEdits）、手动审批、Ultraplan 云端细化、继续规划
- **Teammate 审批**: plan_mode_required teammate 通过 mailbox 向 team-lead 发送 `plan_approval_request`

**优势**:
- Plan 文件持久化 + resume/fork 生命周期完整
- PewterLedger 数据驱动优化
- Mailbox 审批支持多 Agent 协作
- Plan Mode Re-entry 检测

**不足**:
- Plan 文件自由格式 Markdown，无结构化约束
- Verification Agent 触发依赖 system prompt 约定，非机械强制
- 无 Plan vs Reality diff 检查
- ExitPlanMode 后 verification hook 注册代码被 Bun dead code elimination 移除（`CLAUDE_CODE_VERIFY_PLAN='false'`，`undefined === 'true'` 恒为 false，构建时 tree-shake）

### 1.2 CoStrict 自定义工作流

**两条主线（agents/ 新版）**:

```
StrictPlanAgent (L0)                    StrictSpec (入口)
  ├── QuickExplore (L1)                   ├── Requirement → spec.md
  ├── AskUserQuestion                     ├── DesignAgent → tech.md (C4 Model)
  ├── proposal.md + task.md (五要素)       ├── TaskPlan → plan.md (≤3 条任务)
  ├── SubCoding (L1) 叶子执行              └── SpecPlan (L2)
  ├── TaskCheck (L1) 质量检查                  ├── QuickExplore (L1)
  └── TDD (L1) RunAndFix→Design→Fix           ├── TaskCheck (L1)
                                                └── SubCoding (L1)
```

**backup/ 旧版的区别**: `backup/strictPlan.ts` 通过 PlanApply (L1.5) 分发 SubCoding，而非直接分发。`backup/specPlan.ts`、`backup/planApply.ts`、`backup/reviewAndFix.ts` 同样已过时。

**优势**:
- 五要素任务格式（目标对象/修改目的/修改方式/相关依赖/修改内容）使任务可验证
- 严格层级约束 (L0→L1→禁止嵌套)
- 探索驱动澄清："项目信息优先，凡可通过代码获得的不得向用户提问"
- 需求可追溯性: spec.md → tech.md → plan.md → task.md
- C4 Model 四层架构设计

**不足**:
- agents/ 和 backup/ 目录大量重复，旧版未清理
- task.md 五要素格式人工编写和维护成本高
- 与原生 Plan Mode 使用不同文件体系（`.cospec/` vs `~/.claude/plans/`）
- ReviewAndFix (backup/) 依赖 checkpoint 工具，有 fallback 逻辑
- TDD Agent 手动触发，无自动 test-run-fix loop

### 1.3 原生 Task/Swarm 体系

**核心**:
- Task: JSON 文件 `~/.claude/tasks/<taskListId>/<id>.json`，proper-lockfile 并发安全，blocks/blockedBy 双向依赖
- Swarm: Tmux / iTerm2 / Windows Terminal / InProcess 四后端
- Team: `~/.claude/teams/<name>/config.json`，mailbox 消息传递
- TaskUpdate 联动: VERIFICATION_AGENT 开启时，3+ 非 verification 任务全部完成 → 追加 spawn verification agent 提醒

**优势**: 并发安全、多后端、原子操作、Task-Verification 联动

**不足**: Task 系统不与 CoStrict 的 task.md 互通，两套任务追踪体系

---

## 二、2026 行业最佳实践对标

### 2.1 Plan Mode / 方向锁定

| 最佳实践 | 行业做法 | CSC 现状 | 差距 |
|----------|---------|---------|------|
| 结构化 Plan 格式 | Summary / Files / Approach / Verification / Scope 分离 | 自由格式 Markdown（PewterLedger 实验中） | **部分满足** |
| `[ASSUMPTION]` 标签 | 标记模型假设供人类快速审查 | 无 | **缺失** |
| 机械审批门禁 | Harness config 强制门禁，非 prompt 约定 | `requiresUserInteraction()=true` 已是机械门禁 | **已满足** |
| Plan vs Reality Diff | 实施后检查是否偏离 plan scope | 无 | **缺失** |
| 条件路由 | Review 失败 → Executor / Planner | 手动 | **需改进** |

### 2.2 Verification / 质量门禁

| 最佳实践 | 行业做法 | CSC 现状 | 差距 |
|----------|---------|---------|------|
| 测试作为验收条件 | Tests = definition of done | TDD Agent + Verification Agent | **已有但割裂** |
| 自动 test-run-fix loop | 3 retries，失败 escalation | 手动触发 | **需改进** |
| 角色分离验证 | 不同模型 + fresh context | Verification Agent 独立 context | **已满足** |
| Decision stub | PR 模板: constraints/alternatives/verification | 无 | **缺失** |
| Scope ledger | 5 行: goal/allowed/forbidden/verify/owner | plan 文件近似但不标准化 | **部分满足** |

### 2.3 Multi-Agent 协作

| 最佳实践 | 行业做法 | CSC 现状 | 差距 |
|----------|---------|---------|------|
| Planner→Executor→Reviewer | 强模型规划 / 弱模型执行 / 独立审查 | StrictPlan (L0) → SubCoding (L1) → TaskCheck (L1) | **已满足** |
| Worktree 隔离 | 每 agent 独立 worktree | `isolation: "worktree"` | **已满足** |
| 简单任务折叠角色 | <100 行自审查 | SubCoding 直接执行 | **已满足** |
| 上下文打包 | 符号分析 + 影响地图 | QuickExplore Agent | **已满足** |

### 2.4 Harness 改进循环 & 度量

| 最佳实践 | 行业做法 | CSC 现状 | 差距 |
|----------|---------|---------|------|
| 错误分类→harness 修复 | 每类 error 对应 harness change | 无系统化机制 | **缺失** |
| Golden Principles | 5-10 条机械规则 (hook exit code 2) | Biome + husky（语言层面，非逻辑层面） | **部分满足** |
| Agent task success rate | ≥85% | 无度量 | **缺失** |
| Auto-remediation rate | ≥60% | 无度量 | **缺失** |
| Skill invocation accuracy | ≥90% | 无度量 | **缺失** |

---

## 三、改进建议（按优先级）

### P0 — 统一工程流程入口

**问题**: agents/ + backup/ + 原生 Plan Mode 三套体系并存，功能重叠，维护成本翻倍。

**建议**:

1. **删除 backup/ 旧版 Agent** — `strictPlan.ts`、`planApply.ts`、`specPlan.ts`、`reviewAndFix.ts` 已被 agents/ 新版替代，且无其他模块引用
2. **统一入口命名** — `/plan` (原生) + `/strict-plan` (CoStrict) + `/strict-spec` (完整规格)，在 CLAUDE.md 提供选择指南
3. **统一文件体系** — CoStrict `.cospec/` 输出同时同步简化版到 `~/.claude/plans/`，避免两份完全独立的计划文件
4. **考虑合并两套体系** — 长期看，StrictPlan 的结构化优势应反哺到原生 Plan Mode 中

### P1 — Plan 文件结构化

**问题**: 自由格式 Markdown，模型可能遗漏关键信息。

**建议**:

1. **System prompt 要求结构化 sections**:
   ```markdown
   ## Summary (1-2 sentences)
   ## Files to change (exhaustive, with paths)
   ## Approach
   ## Verification (exact commands)
   ## Scope boundaries (files NOT to touch)
   ## Assumptions ([ASSUMPTION] markers)
   ```
2. **ExitPlanModeV2Tool.validateInput 增加结构校验** — 缺少关键 section 返回 message 要求补充
3. **`[ASSUMPTION]` 标签** — 模型显式标注假设，人类审查快速定位决策点
4. **PewterLedger 新增实验 arm** — 将结构化要求作为新的 arm 加入 A/B 测试

### P2 — 自动化 Verification Loop

**问题**: Verification Agent 手动触发，FAIL 后无自动重试。

**建议**:

1. **System prompt 强制 gate** — 3+ 文件 / API / 基础设施变更 → 必须调用 Verification Agent。利用 TaskUpdateTool 已有逻辑 (line 412) 扩展到 ExitPlanMode 时强制检查
2. **自动 retry loop** — FAIL → 主 Agent 分析 → 修复 → 重验证 (最多 3 次)；3 次后 escalation 附带完整失败历史；用 TaskCreate 跟踪每次 retry
3. **整合 TDD Agent + Verification Agent** — 统一输出格式：PASS/FAIL/PARTIAL + Command run + Output observed

### P3 — Plan vs Reality Diff

**问题**: 实施完成后无偏离检查。

**建议**:

1. **Verification Agent 增加 plan-vs-reality 步骤**:
   - 读取 plan "Files to change" → 对比 `git diff` 实际修改
   - 标记 Scope creep（多改）/ Incomplete（少改）/ Match
2. **偏离报告**作为 Verification Agent 输出 section，影响 PASS/FAIL/PARTIAL 判定
3. **埋点** `plan_reality_divergence` 用于分析模型行为

### P4 — Harness 改进日志 + Golden Principles

**问题**: 工作流失败只修 prompt，不修 harness。

**建议**:

1. **`.cospec/IMPROVEMENTS.md`** — 记录: 触发条件 / 根因分类 (context/pattern/verification/boundary/tool-misuse) / harness 修复 / 是否复发
2. **Golden Principles 机械强制** — 5-10 条高频违规 → PreToolUse/PostToolUse hooks → exit code 2 阻止 + fix suggestion

### P5 — 度量系统

**问题**: 无量化数据。

**建议**:

1. **利用现有 `logEvent()` 增加埋点**: `plan_created/approved/rejected`、`verification_pass/fail/retry`、`task_divergence_detected`、`agent_task_success/failure`
2. **Harness health dashboard** — 可集成到 RCS Web UI

### P6 — Skills 优化

**建议** (来自 Claude Code 生产环境):

1. Description 写 routing logic 而非 marketing copy
2. 每个 skill 增加 "Don't call this skill when..." 负例 — 这在生产环境恢复了 20% 准确率
3. 模板和示例嵌入 skill 内部，而非 system prompt

---

## 四、实施路线图

### 第一阶段（短期）— 低风险、高收益
- **P1**: Plan 文件结构化 — 修改 `src/utils/messages.ts` Phase 4 section + ExitPlanModeV2Tool.validateInput
- **P3**: Plan vs Reality Diff — 修改 Verification Agent prompt
- **P6**: Skills 负例 — 不改架构，只改 skill 定义文件

### 第二阶段（中期）— 流程整合
- **P0**: 清理 backup/ 旧 Agent + 统一入口 + 更新 CLAUDE.md 选择指南
- **P2**: 自动化 Verification Loop — system prompt gate + retry 逻辑

### 第三阶段（长期）— 基础设施
- **P4**: IMPROVEMENTS.md + Golden Principles hooks
- **P5**: 度量埋点 + dashboard

---

## 五、验证方案

1. `bun run precheck` — typecheck + lint fix + test 全通过（当前 2992 tests, 0 fail）
2. 端到端 `/plan`: Enter → 结构化 plan → Exit (校验) → 实施 → Verification (含 plan-vs-reality)
3. 端到端 `/strict-plan`: 完整 StrictPlan → SubCoding → TaskCheck → TDD
4. `bun test` 全量回归
5. 人工审查 10 个 plan 文件的结构完整性（优化前后对比）