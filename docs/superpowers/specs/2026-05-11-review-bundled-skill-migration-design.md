# Review Bundled Skill Migration Design

## Goal

将 review 和 security-review 从 agent-based + 自定义 extension 初始化架构迁移到 csc 内置的 bundled skill `files` 机制，对齐上游 [opencode#360](https://github.com/zgsm-sangfor/opencode/pull/360) 和 [costrict-review#11](https://github.com/zgsm-ai/costrict-review/pull/11) 的 skill-only 架构。

## Background

上游变更：
- `index.json` 移除了 `agents` 字段，CoStrictReviewer/CoStrictValidator agent 不再存在
- `review` 和 `security-review` 都改为 skill 形式，目录结构从 `en/skills/...` 变为 `skills/en/...`
- SKILL.md frontmatter 简化为 `name` + `description`

csc 现状：
- 生成脚本同时生成 agent 和 skill builtin 文件
- `extension.ts` 在启动时主动提取 skill 到 `~/.claude/skills/`
- `builtInAgents.ts` 注册 REVIEW_AGENTS 到 AgentTool
- `strict:review` / `strict:security-review` 通过 `agent: 'CoStrictReviewer'` 路由

## Architecture

使用 csc 已有的 `registerBundledSkill({ files })` 机制替代自定义初始化。`files` 字段在首次调用时通过 `extractBundledSkillFiles()` 按需落盘到 `getBundledSkillsRoot()/<name>/`，并自动给 prompt 添加 `Base directory for this skill: <dir>` 前缀。

语言切换：启动时通过 `getResolvedLanguage()` 确定语言，从 `SKILL_FILES[locale]` 取对应语言的数据注册。

## Changes

### 1. `scripts/generate-review-builtin.ts`

- `IndexJson` 类型移除 `agents` 字段
- 路径处理适配新结构 `skills/en/...`
- 移除 `generateBuiltinAgents()` 函数
- `generateBuiltinSkills()` 产物改为导出：
  - `SKILL_FILES: Record<string, Record<string, Record<string, string>>>`（locale → skillName → filePath → content）
  - `SKILL_METADATA: Record<string, Record<string, { name: string; description: string }>>`（locale → skillName → 元数据）
- 解析 SKILL.md frontmatter 提取 `name` 和 `description`
- agent builtin 文件输出为空 stub

### 2. `src/costrict/review/skill/builtin.ts`（生成产物）

- 导出 `SKILL_FILES`、`SKILL_METADATA`
- 移除 `extractBundledSkill()`、`listBuiltinSkills()` 等函数

### 3. `src/costrict/review/agent/builtin.ts`

- 保持空 stub，`REVIEW_AGENTS: BuiltInAgentDefinition[] = []`

### 4. 新建 `src/costrict/skills/reviewSkills.ts`

- `registerReviewSkills()` 函数
- 调用 `getResolvedLanguage()` → `LOCALE_MAP` 确定语言
- 从 `SKILL_FILES[locale]` 读取每个 skill 的文件
- 从 `SKILL_METADATA[locale]` 读取 description
- 调用 `registerBundledSkill()` 注册 `review` 和 `security-review`：
  - `context: 'fork'`
  - `allowedTools: ['AskUserQuestion', 'Read', 'Glob', 'Grep', 'Bash', 'Agent']`
  - `files`: locale-specific 文件数据
  - `getPromptForCommand`: 返回 SKILL.md body（$ARGUMENTS 替换）

### 5. 删除 `src/costrict/review/extension.ts`

- `initializeBuiltinSkills()` 不再需要，bundled skill 机制自行处理文件落盘

### 6. 更新 `src/costrict/review/index.ts`

- 移除 extension 导出

### 7. 更新 `src/skills/bundled/index.ts`

- 移除 `import { initializeBuiltinSkills }` 和调用
- 添加 `import { registerReviewSkills }` 并调用

### 8. 更新 `src/costrict/skills/strictReview.ts`

- 移除 `agent: 'CoStrictReviewer'`
- 改为使用 `files` 机制（或与 reviewSkills 共用注册逻辑）

### 9. 更新 `src/costrict/skills/strictSecurityReview.ts`

- 同上

### 10. 更新 `src/commands/review.ts`

- 移除 `agent: PRIMARY_REVIEW_AGENT || 'CoStrictReviewer'`
- prompt 改为告诉 model 加载 review skill（对齐上游）

### 11. 更新 `src/commands/security-review.ts`

- prompt 改为告诉 model 加载 security-review skill

### 12. 更新 `packages/builtin-tools/src/tools/AgentTool/builtInAgents.ts`

- 移除 `REVIEW_AGENTS` import 和 `agents.push(...REVIEW_AGENTS)`

### 13. 清理

- 移除 `src/costrict/command/locales/` 目录（不再需要，prompt 来自 SKILL.md）
- 移除 `.gitignore` 中 `packages/builtin-tools/bundled-review/` 相关规则
- agent builtin stub 保留在 `.gitignore`

## Files Summary

| Action | File |
|--------|------|
| Modify | `scripts/generate-review-builtin.ts` |
| Generated | `src/costrict/review/skill/builtin.ts` |
| No change | `src/costrict/review/agent/builtin.ts` (stub) |
| Create | `src/costrict/skills/reviewSkills.ts` |
| Delete | `src/costrict/review/extension.ts` |
| Modify | `src/costrict/review/index.ts` |
| Modify | `src/skills/bundled/index.ts` |
| Modify | `src/costrict/skills/strictReview.ts` |
| Modify | `src/costrict/skills/strictSecurityReview.ts` |
| Modify | `src/commands/review.ts` |
| Modify | `src/commands/security-review.ts` |
| Modify | `packages/builtin-tools/src/tools/AgentTool/builtInAgents.ts` |
| Delete | `src/costrict/command/locales/` directory |
