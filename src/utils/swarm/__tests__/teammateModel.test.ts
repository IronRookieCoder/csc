import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { saveGlobalConfig } from 'src/utils/config.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import { resolveTeammateModel } from '../teammateModel.js'

const providerEnvKeys = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_COSTRICT',
] as const

let previousProviderEnv: Record<
  (typeof providerEnvKeys)[number],
  string | undefined
>

function clearTeammateDefaultModel(): void {
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
  saveGlobalConfig(config => {
    const next = { ...config }
    delete next.teammateDefaultModel
    return next
  })
}

beforeEach(() => {
  previousProviderEnv = {} as Record<
    (typeof providerEnvKeys)[number],
    string | undefined
  >
  for (const key of providerEnvKeys) {
    previousProviderEnv[key] = process.env[key]
    delete process.env[key]
  }
  clearTeammateDefaultModel()
})

afterEach(() => {
  for (const key of providerEnvKeys) {
    if (previousProviderEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = previousProviderEnv[key]
    }
  }
  clearTeammateDefaultModel()
})

describe('resolveTeammateModel', () => {
  test('inherits the leader model by default for CoStrict', () => {
    process.env.CLAUDE_CODE_USE_COSTRICT = '1'

    expect(resolveTeammateModel(undefined, 'CoStrict-DeepSeek-V4-Pro')).toBe(
      'CoStrict-DeepSeek-V4-Pro',
    )
  })

  test('keeps the hardcoded Opus fallback by default for first-party', () => {
    expect(resolveTeammateModel(undefined, 'claude-sonnet-4-5')).toBe(
      'claude-opus-4-6',
    )
  })

  test('keeps explicit teammate model values', () => {
    process.env.CLAUDE_CODE_USE_COSTRICT = '1'

    expect(
      resolveTeammateModel('deepseek-v4-flash', 'deepseek-v4-pro[1m]'),
    ).toBe('deepseek-v4-flash')
  })

  test('keeps inherit alias behavior', () => {
    expect(resolveTeammateModel('inherit', 'claude-sonnet-4-5')).toBe(
      'claude-sonnet-4-5',
    )
  })
})
