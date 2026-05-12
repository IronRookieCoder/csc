# Review Skill Extract-to-Disk Migration Design

## Goal

将 review 和 security-review 从 `registerBundledSkill()` 内存内嵌方式迁移到 **extract-to-disk + 标准 skill scanner 发现** 的架构，完全对齐上游 [opencode#360](https://github.com/zgsm-sangfor/opencode/pull/360) 的实现模式。

彻底移除 `registerBundledSkill` 对 review/security-review 的使用。

## Background

当前问题：
- `src/costrict/review/skill/builtin.ts` 是 2.5MB 的内嵌文件，所有 skill 内容在内存中
- `reviewSkills.ts` 通过 `registerBundledSkill()` 注册，绕过了标准 skill 发现流程
- strict:review / strict:security-review 也是 bundled skill 方式，增加了复杂度

PR #360 的方案：
- 生成脚本从 `zgsm-ai/costrict-review` 远程仓库拉取资源
- 运行时通过 `extension.ts` 将 skill 提取到磁盘缓存目录（`~/.claude/skills/` 或类似目录）
- `.version` 文件跟踪版本 + locale
- 标准 skill scanner 从磁盘目录发现并加载 skill
- `/review`、`/security-review` 命令模板只说 "请使用 Skill 工具加载 X 技能"

## Architecture

```
Build time:
  scripts/generate-review-builtin.ts
    → git clone zgsm-ai/costrict-review
    → 读取 index.json
    → 生成 src/costrict/review/skill/builtin.ts (内嵌所有文件内容)

Runtime:
  Startup → extension.ts:initializeBuiltinSkills(locale)
    → 检查 .version 文件（版本+语言）
    → 如需更新，调用 builtin.ts:extractBundledSkill() 写入磁盘
    → 标准 skill scanner 扫描缓存目录，发现 review / security-review

Commands:
  /review → CommandLocale.get('review') → "请使用 Skill 工具加载 review 技能"
  /security-review → CommandLocale.get('security-review') → "请使用 Skill 工具加载 security-review 技能"
```

## Changes

### 1. 新增 `scripts/generate-review-builtin.ts`

生成脚本，参考 PR #360 的同名文件：
- 通过 `git ls-remote` 获取远程 SHA，与缓存 SHA 对比
- `git clone --depth 1` 浅克隆 `zgsm-ai/costrict-review` 仓库
- 读取 `index.json`，收集所有 skill 及其 locale 路径
- 将 skill 文件内容内嵌为 TypeScript 常量
- 生成 `src/costrict/review/skill/builtin.ts`，导出：
  - `SKILL_FILES: Record<string, Record<string, Record<string, string>>>` (locale → skillName → filePath → content)
  - `SKILL_METADATA: Record<string, Record<string, { name: string; description: string }>>` (locale → skillName → 元数据，从 SKILL.md frontmatter 解析)
  - `SKILL_VERSIONS: Record<string, string>` (skillName → commit SHA)
  - `extractBundledSkill(skillName, targetDir, locale)` — 提取到磁盘
  - `listBuiltinSkills()` — 返回所有 skill 名称
  - `getBuiltinSkillVersion(skillName)` — 返回版本

### 2. 重新生成 `src/costrict/review/skill/builtin.ts`

由脚本生成的产物，从 2.5MB 精简为只包含：
- `SKILL_FILES` 多 locale 数据
- `SKILL_METADATA` 元数据
- `SKILL_VERSIONS` 版本
- `extractBundledSkill()` 提取函数

不再导出 `extractBundledSkill()` 以外的运行时函数。

### 3. 新增 `src/costrict/review/extension.ts`

运行时初始化逻辑：
- `initializeBuiltinSkills(locale: string)` — 遍历所有 builtin skill，按需提取到磁盘
- `needsUpdate(skillDir, skillName, locale)` — 检查 `.version` 文件（格式：`sha:locale`）
- `writeVersionFile(skillDir, skillName, locale)` — 写入版本+语言标记
- `getBuiltinSkillsDir()` — 返回缓存根目录

### 4. 修改 `src/costrict/review/index.ts`

- 移除 `agent/builtin.ts` 相关导出
- 导出 `Extension` from `./extension.js`
- 导出 `SkillBuiltin` from `./skill/builtin.js`

### 5. 删除 `src/costrict/skills/reviewSkills.ts`

移除整个文件，不再需要 `registerBundledSkill` 注册。

### 6. 修改 `src/skills/bundled/index.ts`

- 移除 `import { registerReviewSkills }` 和调用
- 改为在 skill 初始化阶段调用 `Extension.initializeBuiltinSkills(locale)`

### 7. 修改 `src/costrict/command/locales/index.ts`

保持不变，locale 模板继续用于 `/review` 和 `/security-review` 命令。

### 8. 修改 `package.json`

- 添加 `"build:builtin-review": "bun run scripts/generate-review-builtin.ts"` 脚本
- 将 `build:builtin` 改为包含 `build:builtin-review`

### 9. 修改 `.gitignore`

- 添加 `bundled-review/`（生成脚本的临时下载目录）
- 保留 `src/costrict/review/skill/builtin.ts` 在 `.gitignore`（生成产物）

### 10. 清理

- 移除 `src/costrict/review/agent/builtin.ts`（不再有 review agent）
- 移除 `REVIEW_AGENTS`、`AGENT_VERSIONS`、`PRIMARY_REVIEW_AGENT`、`SUB_REVIEW_AGENT` 的导出和引用
- 移除 `builtInAgents.ts` 中的 review agent 注册
- 移除 strict:review / strict:security-review 的 bundled skill 注册

## Files Summary

| Action | File |
|--------|------|
| Create | `scripts/generate-review-builtin.ts` |
| Create | `src/costrict/review/extension.ts` |
| Generated | `src/costrict/review/skill/builtin.ts` |
| Modify | `src/costrict/review/index.ts` |
| Delete | `src/costrict/skills/reviewSkills.ts` |
| Delete | `src/costrict/review/agent/builtin.ts` |
| Modify | `src/skills/bundled/index.ts` |
| Modify | `package.json` |
| Modify | `.gitignore` |
| Modify | Agent 注册（移除 review agent） |

## Key Differences from Previous Design

| Aspect | 旧方案 (registerBundledSkill) | 新方案 (extract-to-disk) |
|--------|------|------|
| 运行时 | 内存内嵌 + getPromptForCommand | 提取到磁盘 + 标准 scanner |
| 发现方式 | registerBundledSkill 注册到数组 | skill scanner 扫描目录 |
| 版本追踪 | 无 | .version 文件（sha:locale） |
| strict 变种 | 单独注册 bundled skill | 不需要，走标准流程 |
| extension.ts | 删除 | 新增（提取逻辑） |
