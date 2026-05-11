import { registerBundledSkill } from 'src/skills/bundledSkills.js'
import { getResolvedLanguage } from 'src/utils/language.js'
import {
  SKILL_FILES,
  SKILL_METADATA,
} from 'src/costrict/review/skill/builtin.js'

const LOCALE_MAP: Record<string, string> = { zh: 'zh-CN', en: 'en' }

function getLocale(): string {
  const lang = getResolvedLanguage()
  return LOCALE_MAP[lang] ?? 'zh-CN'
}

function registerSkillVariant(
  name: string,
  skillKey: string,
  files: Record<string, string>,
  description: string,
): void {
  registerBundledSkill({
    name,
    description,
    whenToUse: description,
    userInvocable: true,
    disableModelInvocation: true,
    allowedTools: [
      'Glob',
      'Grep',
      'Read',
      'TodoWrite',
      'Bash',
      'Agent',
    ],
    model: 'inherit',
    context: 'fork',
    files,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: args.trim() || `Please perform a ${skillKey}.` }]
    },
  })
}

export function registerReviewSkills(): void {
  const locale = getLocale()
  const localeFiles = SKILL_FILES[locale]
  const localeMetadata = SKILL_METADATA[locale]
  if (!localeFiles || !localeMetadata) return

  for (const [skillKey, files] of Object.entries(localeFiles)) {
    const meta = localeMetadata[skillKey]
    if (!meta || !files) continue

    // Register /review, /security-review
    registerSkillVariant(meta.name, skillKey, files, meta.description)

    // Register /strict:review, /strict:security-review
    registerSkillVariant(`strict:${skillKey}`, skillKey, files, meta.description)
  }
}
