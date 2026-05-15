import { CLAUDE_OPUS_4_6_CONFIG } from '../model/configs.js'
import { parseUserSpecifiedModel } from '../model/model.js'
import { getAPIProvider } from '../model/providers.js'
import { getGlobalConfig } from '../config.js'

// @[MODEL LAUNCH]: Update the fallback model below.
// When the user has never set teammateDefaultModel in /config, new teammates
// use Opus 4.6. Must be provider-aware so Bedrock/Vertex/Foundry customers get
// the correct model ID.
export function getHardcodedTeammateModelFallback(): string {
  return CLAUDE_OPUS_4_6_CONFIG[getAPIProvider()]
}

export function getDefaultTeammateModel(leaderModel: string | null): string {
  const configured = getGlobalConfig().teammateDefaultModel
  if (configured === null) {
    // User picked "Default" in the /config picker — follow the leader.
    return leaderModel ?? getHardcodedTeammateModelFallback()
  }
  if (configured !== undefined) {
    return parseUserSpecifiedModel(configured)
  }
  if (getAPIProvider() === 'costrict' && leaderModel) {
    return leaderModel
  }
  return getHardcodedTeammateModelFallback()
}

/**
 * Resolve a teammate model value. Handles the 'inherit' alias (from agent
 * frontmatter) by substituting the leader's model.
 */
export function resolveTeammateModel(
  inputModel: string | undefined,
  leaderModel: string | null,
): string {
  if (inputModel === 'inherit') {
    return leaderModel ?? getDefaultTeammateModel(leaderModel)
  }
  return inputModel ?? getDefaultTeammateModel(leaderModel)
}
