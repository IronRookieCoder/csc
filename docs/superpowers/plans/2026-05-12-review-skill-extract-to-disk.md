# Review Skill Extract-to-Disk Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate review and security-review from `registerBundledSkill()` to extract-to-disk + standard skill scanner discovery, aligning with upstream opencode PR #360.

**Architecture:** A generate script (`scripts/generate-review-builtin.ts`) downloads skills from the `zgsm-ai/costrict-review` repo and produces `src/costrict/review/skill/builtin.ts` with embedded content. At runtime, `extension.ts` extracts skills to `~/.claude/skills/<name>/` on first run (tracked by `.version` file with `sha:locale` format). The standard skill scanner in `loadSkillsDir.ts` discovers them from that directory.

**Tech Stack:** TypeScript, Bun runtime, git CLI (for clone), gray-matter (frontmatter parsing)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `scripts/generate-review-builtin.ts` | Add `extractBundledSkill()` to generated output |
| Create | `src/costrict/review/extension.ts` | Runtime extraction to `~/.claude/skills/` |
| Modify | `src/costrict/review/index.ts` | Export Extension, remove agent exports |
| Delete | `src/costrict/skills/reviewSkills.ts` | Remove registerBundledSkill registration |
| Delete | `src/costrict/review/agent/builtin.ts` | Remove (does not exist on disk, only referenced) |
| Modify | `src/skills/bundled/index.ts` | Remove `registerReviewSkills()`, call Extension init |
| Modify | `package.json` | Add `build:builtin-review` script |
| Modify | `.gitignore` | Add `bundled-review/` at root level |
| Modify | `src/utils/language.ts` or inline | Ensure `getResolvedLanguage` is available |

---

### Task 1: Update generate script to include `extractBundledSkill()` in output

**Files:**
- Modify: `scripts/generate-review-builtin.ts:223-265`

The current generate script already produces a complete `builtin.ts`. We need to add the `extractBundledSkill()` function to the generated output so skills can be written to disk at runtime.

- [ ] **Step 1: Add `extractBundledSkill()` to the generated template in `generate-review-builtin.ts`**

In the `generateBuiltinSkills()` function (line 223), modify the `content` template string to add the `extractBundledSkill()` function before the closing backtick. Add it after the existing `getSkillMetadata()` function:

```typescript
// In the content template string, append before the closing `:
export async function extractBundledSkill(skillName: string, targetDir: string, locale: string): Promise<void> {
  const localeData = SKILL_FILES[locale]
  if (!localeData) {
    throw new Error(\`Locale not found: \${locale}\`)
  }

  const skillFiles = localeData[skillName]
  if (!skillFiles) {
    throw new Error(\`Skill not found: \${skillName}\`)
  }

  const { mkdir: mkdirSync } = await import('fs/promises')
  const { join: pathJoin, dirname: pathDirname } = await import('path')
  await mkdirSync(targetDir, { recursive: true })
  for (const [relativePath, fileContent] of Object.entries(skillFiles)) {
    await mkdirSync(pathJoin(targetDir, pathDirname(relativePath)), { recursive: true })
    const { writeFile: writeFileFn } = await import('fs/promises')
    await writeFileFn(pathJoin(targetDir, relativePath), fileContent, 'utf-8')
  }
}
```

Find the line in `generate-review-builtin.ts` that reads:
```typescript
// Get metadata for a skill in a specific locale
export function getSkillMetadata(skillName: string, locale: string): { name: string; description: string } | undefined {
  return SKILL_METADATA[locale]?.[skillName]
}
```

Append the `extractBundledSkill` function after it, before the template closing backtick.

- [ ] **Step 2: Verify the script runs**

Run: `bun run scripts/generate-review-builtin.ts`

Expected: Script downloads resources and regenerates `src/costrict/review/skill/builtin.ts` with the new `extractBundledSkill()` export. Check the last lines of the generated file contain the function.

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-review-builtin.ts src/costrict/review/skill/builtin.ts
git commit -m "feat: add extractBundledSkill to generated builtin output"
```

---

### Task 2: Create `src/costrict/review/extension.ts`

**Files:**
- Create: `src/costrict/review/extension.ts`

This module handles runtime extraction of builtin review skills to `~/.claude/skills/`. It checks a `.version` file (format: `sha:locale`) to decide whether re-extraction is needed.

- [ ] **Step 1: Create the extension module**

```typescript
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from 'src/utils/paths.js'
import { getResolvedLanguage } from 'src/utils/language.js'
import {
  listBuiltinSkillNames,
  getBuiltinSkillVersion,
  extractBundledSkill,
} from './skill/builtin.js'

const LOCALE_MAP: Record<string, string> = { zh: 'zh-CN', en: 'en' }

function getLocale(): string {
  const lang = getResolvedLanguage()
  return LOCALE_MAP[lang] ?? 'zh-CN'
}

function getReviewSkillsDir(): string {
  return join(getClaudeConfigHomeDir(), 'skills')
}

function getVersionFilePath(skillDir: string): string {
  return join(skillDir, '.version')
}

async function getInstalledVersion(skillDir: string): Promise<string | null> {
  try {
    return await readFile(getVersionFilePath(skillDir), 'utf-8')
  } catch {
    return null
  }
}

async function writeVersionFile(
  skillDir: string,
  skillName: string,
  locale: string,
): Promise<void> {
  const builtinVersion = getBuiltinSkillVersion(skillName)
  if (!builtinVersion) return
  await writeFile(getVersionFilePath(skillDir), `${builtinVersion}:${locale}`, 'utf-8')
}

async function needsUpdate(
  skillDir: string,
  skillName: string,
  locale: string,
): Promise<boolean> {
  const builtinVersion = getBuiltinSkillVersion(skillName)
  if (!builtinVersion) return true
  const installed = await getInstalledVersion(skillDir)
  return installed !== `${builtinVersion}:${locale}`
}

export async function initializeBuiltinSkills(): Promise<void> {
  const locale = getLocale()
  const skillsDir = getReviewSkillsDir()
  const skillNames = listBuiltinSkillNames()

  for (const skillName of skillNames) {
    const skillDir = join(skillsDir, skillName)
    if (!(await needsUpdate(skillDir, skillName, locale))) continue

    await mkdir(skillDir, { recursive: true })
    await extractBundledSkill(skillName, skillDir, locale)
    await writeVersionFile(skillDir, skillName, locale)
  }
}

export function getBuiltinSkillsDir(): string {
  return getReviewSkillsDir()
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit 2>&1 | head -20`

Expected: No errors related to `extension.ts`. (There may be pre-existing errors from other files.)

- [ ] **Step 3: Commit**

```bash
git add src/costrict/review/extension.ts
git commit -m "feat: add review skill extension for extract-to-disk"
```

---

### Task 3: Update `src/costrict/review/index.ts`

**Files:**
- Modify: `src/costrict/review/index.ts`

Remove the agent builtin exports and add the Extension export.

- [ ] **Step 1: Rewrite `index.ts`**

Replace the entire file content with:

```typescript
/**
 * CoStrict Review Module
 *
 * Provides builtin review skills that are extracted to disk at runtime
 * and discovered by the standard skill scanner.
 */

export * as SkillBuiltin from './skill/builtin.js'
export * as Extension from './extension.js'
```

- [ ] **Step 2: Verify no other files import the removed exports**

Run: `grep -rn "REVIEW_AGENTS\|AGENT_VERSIONS\|PRIMARY_REVIEW_AGENT\|SUB_REVIEW_AGENT" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v ".d.ts"`

Expected: No results (these exports were only referenced by the deleted `reviewSkills.ts` and the old `index.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/costrict/review/index.ts
git commit -m "refactor: update review index to export Extension"
```

---

### Task 4: Delete `src/costrict/skills/reviewSkills.ts`

**Files:**
- Delete: `src/costrict/skills/reviewSkills.ts`

This file registered review skills via `registerBundledSkill()`. It is no longer needed.

- [ ] **Step 1: Delete the file**

```bash
git rm src/costrict/skills/reviewSkills.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor: remove reviewSkills bundled skill registration"
```

---

### Task 5: Update `src/skills/bundled/index.ts`

**Files:**
- Modify: `src/skills/bundled/index.ts`

Remove the `registerReviewSkills` import and call. Add a call to `Extension.initializeBuiltinSkills()`.

- [ ] **Step 1: Remove review skill registration and add extension initialization**

In `src/skills/bundled/index.ts`:

1. Remove the line:
```typescript
import { registerReviewSkills } from 'src/costrict/skills/reviewSkills.js'
```

2. Add the import:
```typescript
import { Extension as ReviewExtension } from 'src/costrict/review/index.js'
```

3. In `initBundledSkills()`, replace:
```typescript
registerReviewSkills()
```
with:
```typescript
ReviewExtension.initializeBuiltinSkills().catch(() => {})
```

The `.catch(() => {})` handles the case where extraction fails (e.g., no write permissions) without blocking startup.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit 2>&1 | head -20`

Expected: No errors related to `bundled/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/skills/bundled/index.ts
git commit -m "refactor: replace registerReviewSkills with extract-to-disk init"
```

---

### Task 6: Update `package.json` and `.gitignore`

**Files:**
- Modify: `package.json` (scripts section)
- Modify: `.gitignore`

- [ ] **Step 1: Add `build:builtin-review` script to `package.json`**

In the `"scripts"` section of `package.json`, add after the existing build-related scripts:

```json
"build:builtin-review": "bun run scripts/generate-review-builtin.ts",
```

Also, if there is a `"build:builtin"` script, update it to include `build:builtin-review`. If not, no chained script is needed — the generate script can be run independently.

- [ ] **Step 2: Update `.gitignore`**

Verify the existing `.gitignore` already has these entries (they were found in the current file):
```
# Auto-generated review builtin files
src/costrict/review/agent/builtin.ts
src/costrict/review/skill/builtin.ts

# Review builtin cache
packages/builtin-tools/bundled-review/
```

Add a root-level cache directory entry:
```
# Review skill generation cache
bundled-review/
```

- [ ] **Step 3: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: add build:builtin-review script and gitignore entries"
```

---

### Task 7: Clean up agent-related code

**Files:**
- Check for references to `src/costrict/review/agent/builtin.ts`

The agent builtin file does not exist on disk but is referenced in `src/costrict/review/index.ts` (which we already updated in Task 3). We need to verify no other files reference review agents.

- [ ] **Step 1: Search for remaining review agent references**

Run: `grep -rn "review/agent/builtin\|review.*agent.*builtin\|REVIEW_AGENTS\|PRIMARY_REVIEW_AGENT\|SUB_REVIEW_AGENT\|AGENT_VERSIONS" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".d.ts"`

Expected: No results. (The `index.ts` export was already cleaned in Task 3.)

If any results appear, remove the imports and references.

- [ ] **Step 2: Search for strict:review and strict:security-review references**

Run: `grep -rn "strict:review\|strict:security-review" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules`

Expected: No results. (These were only in the deleted `reviewSkills.ts`.)

If any results appear, remove them.

- [ ] **Step 3: Commit if changes were needed**

```bash
git add -A
git commit -m "chore: clean up review agent references"
```

---

### Task 8: Verify locale command templates are correct

**Files:**
- Verify: `src/costrict/command/locales/en/review.txt`
- Verify: `src/costrict/command/locales/zh-CN/review.txt`
- Verify: `src/costrict/command/locales/en/security-review.txt`
- Verify: `src/costrict/command/locales/zh-CN/security-review.txt`
- Verify: `src/costrict/command/locales/index.ts`

The locale templates should say "Please use the Skill tool to load the `review` / `security-review` skill" which directs the model to invoke the skill from disk.

- [ ] **Step 1: Verify locale files are already correct**

The current content of each file is:

`en/review.txt`:
```
# Code Review

Please use the Skill tool to load the `review` skill to perform a code review on: $ARGUMENTS

Please respond and write all files in English throughout the entire process.
```

`zh-CN/review.txt`:
```
# 代码审查

请使用 Skill 工具加载 `review` 技能来对以下内容执行代码审查：$ARGUMENTS

全程请使用中文进行回答与文件写入。
```

`en/security-review.txt`:
```
# Code Security Review

Please use the Skill tool to load the `security-review` skill to perform a security review on: $ARGUMENTS

Please respond and write all files in English throughout the entire process.
```

`zh-CN/security-review.txt`:
```
# 安全代码审查

请使用 Skill 工具加载 `security-review` 技能来对以下内容执行安全代码审查：$ARGUMENTS

全程请使用中文进行回答与文件写入。
```

Verify these files match the above content. No changes needed.

- [ ] **Step 2: Verify `CommandLocale.get()` is called for `/review` and `/security-review`**

Run: `grep -rn "CommandLocale\|command.*locale" src/commands/ --include="*.ts" | grep -i review`

Expected: The review and security-review commands use `CommandLocale.get('review')` and `CommandLocale.get('security-review')` respectively. If not, they need to be updated.

If the commands don't exist as command definitions yet, they may be relying on the bundled skill registration. In that case, verify the `/review` and `/security-review` commands are still available through the standard skill scanner path. The skill scanner will load them from `~/.claude/skills/review/SKILL.md` and `~/.claude/skills/security-review/SKILL.md`.

---

### Task 9: Run full typecheck and tests

- [ ] **Step 1: Run typecheck**

Run: `bunx tsc --noEmit 2>&1 | head -40`

Expected: Zero errors. Fix any that appear.

- [ ] **Step 2: Run tests**

Run: `bun test 2>&1 | tail -20`

Expected: All tests pass (0 fail).

- [ ] **Step 3: Run lint**

Run: `bun run lint 2>&1 | tail -20`

Expected: No new lint errors related to changed files.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve typecheck/lint errors from review skill migration"
```

---

### Task 10: Verify end-to-end flow

- [ ] **Step 1: Regenerate builtin skills**

Run: `bun run scripts/generate-review-builtin.ts`

Expected: Script downloads (or uses cache) and generates `src/costrict/review/skill/builtin.ts` with `extractBundledSkill()` export.

- [ ] **Step 2: Check generated file has correct exports**

Run: `grep "export.*function\|export.*const" src/costrict/review/skill/builtin.ts`

Expected output includes:
```
export const SKILL_FILES: Record<...>
export const SKILL_METADATA: Record<...>
export const SKILL_VERSIONS: Record<...>
export function listBuiltinSkillNames(): string[]
export function getBuiltinSkillVersion(skillName: string): string | undefined
export function getSkillFiles(skillName: string, locale: string): Record<string, string>
export function getSkillMetadata(skillName: string, locale: string): ...
export async function extractBundledSkill(skillName: string, targetDir: string, locale: string): Promise<void>
```

- [ ] **Step 3: Verify dev mode starts without errors**

Run: `echo "hello" | bun run dev -p 2>&1 | head -20`

Expected: No import errors, no crashes related to review skills.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete review skill extract-to-disk migration"
```
