import { registerBundledSkill } from 'src/skills/bundledSkills.js'
import { getResolvedLanguage } from 'src/utils/language.js'
import {
  SKILL_FILES,
  SKILL_METADATA,
} from 'src/costrict/review/skill/builtin.js'

const LOCALE_MAP: Record<string, string> = { zh: 'zh-CN', en: 'en' }

export function registerReviewSkills(): void {
  const lang = getResolvedLanguage()
  const locale = LOCALE_MAP[lang] ?? 'zh-CN'

  const localeFiles = SKILL_FILES[locale]
  const localeMetadata = SKILL_METADATA[locale]
  if (!localeFiles) return

  for (const [skillName, files] of Object.entries(localeFiles)) {
    const meta = localeMetadata?.[skillName]
    if (!meta) continue

    registerBundledSkill({
      name: meta.name,
      description: meta.description,
      whenToUse: meta.description,
      userInvocable: true,
      disableModelInvocation: true,
      allowedTools: [
        'AskUserQuestion',
        'Read',
        'Glob',
        'Grep',
        'Bash',
        'Agent',
      ],
      context: 'fork',
      files,
      async getPromptForCommand(args) {
        const userRequest = args.trim()
        if (!userRequest) {
          return [
            {
              type: 'text',
              text: `Please use the Skill tool to load '${meta.name}' skill.`,
            },
          ]
        }
        return [
          {
            type: 'text',
            text: userRequest,
          },
        ]
      },
    })
  }
}
