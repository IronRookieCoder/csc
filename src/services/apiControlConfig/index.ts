import { getCoStrictBaseURL } from '../../costrict/provider/auth.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

let _apiEnabled: boolean | null = null

export async function checkApiControlConfig(): Promise<{
  enabled_api: boolean
}> {

  const baseUrl = getCoStrictBaseURL()
  const url = `${baseUrl}/costrict-static/cli-api-control/config.json`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.status !== 200) {
      logForDebugging(
        `API control config: non-200 status (${response.status}) from ${url}, disabling third-party APIs`,
      )
      _apiEnabled = false
      return { enabled_api: false }
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      logForDebugging(
        `API control config: JSON parse failed from ${url}, disabling third-party APIs`,
      )
      _apiEnabled = false
      return { enabled_api: false }
    }

    const enabled =
      data !== null &&
      typeof data === 'object' &&
      'enabled_api' in (data as Record<string, unknown>) &&
      (data as Record<string, unknown>).enabled_api === true

    _apiEnabled = enabled
    logForDebugging(
      `API control config: fetched from ${url}, status=${response.status}, enabled_api=${enabled}`,
    )
    return { enabled_api: enabled }
  } catch (err) {
    clearTimeout(timeoutId)
    const reason = err instanceof Error ? err.message : String(err)
    logForDebugging(
      `API control config: request failed for ${url}: ${reason}, disabling third-party APIs`,
    )
    _apiEnabled = false
    return { enabled_api: false }
  }
}

export function disableNonCoStrictProviders(): void {
  // Clear all third-party provider environment variables
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GROK
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY

  // Force CoStrict as the only available provider
  process.env.CLAUDE_CODE_USE_COSTRICT = '1'

  const settings = getSettings_DEPRECATED()
  const modelType = settings.modelType as string | undefined

  // Clear any non-CoStrict modelType from settings
  if (
    modelType !== undefined &&
    modelType !== 'costrict'
  ) {
    logForDebugging(
      `API control config: clearing modelType '${modelType}' from userSettings`,
    )
    updateSettingsForSource('userSettings', { modelType: undefined })
  }

  // Clear forceLoginMethod — prevents bypassing the idle login screen
  // when third-party APIs are disabled. If forceLoginMethod were left as
  // 'claudeai' or 'console', ConsoleOAuthFlow would skip the idle state
  // and go directly to Anthropic OAuth, bypassing isThirdPartyApiEnabled().
  if (settings.forceLoginMethod) {
    logForDebugging(
      `API control config: clearing forceLoginMethod '${settings.forceLoginMethod}' from userSettings`,
    )
    updateSettingsForSource('userSettings', { forceLoginMethod: undefined } as any)
  }
}

export function isThirdPartyApiEnabled(): boolean {
  return _apiEnabled === true
}

