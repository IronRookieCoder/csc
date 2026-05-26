import {
  API_ERROR_MESSAGE_PREFIX,
  API_TIMEOUT_ERROR_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL,
  ORG_DISABLED_ERROR_MESSAGE_ENV_KEY,
  ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  TOKEN_REVOKED_ERROR_MESSAGE,
} from '../services/api/errors.js'

const HINT_LOGIN =
  'Run /login to re-authenticate, or check ANTHROPIC_API_KEY env variable.'
const HINT_RETRY =
  'Wait a few seconds and retry. If the issue persists, check your network or run /doctor.'
const HINT_COMPACT =
  'Run /compact to compress history, or /clear to start fresh.'
const HINT_TIMEOUT =
  'You can increase timeout via API_TIMEOUT_MS env variable, or retry later.'
const HINT_MODEL =
  'Run /model to switch to an available model, or contact your admin for access.'

/**
 * Return a user-friendly next-step hint for known API error messages.
 * Returns null when no specific hint is available (caller should omit the line).
 */
export function getFriendlyErrorHint(text: string): string | null {
  // Exact-match for constants rendered by AssistantTextMessage switch()
  switch (text) {
    case INVALID_API_KEY_ERROR_MESSAGE:
    case INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL:
      return HINT_LOGIN

    case TOKEN_REVOKED_ERROR_MESSAGE:
      return 'Run /login to refresh your OAuth token.'

    case ORG_DISABLED_ERROR_MESSAGE_ENV_KEY:
    case ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH:
      return 'Update or unset ANTHROPIC_API_KEY to use your subscription.'

    case PROMPT_TOO_LONG_ERROR_MESSAGE:
      return HINT_COMPACT

    case API_TIMEOUT_ERROR_MESSAGE:
      return HINT_TIMEOUT

    default:
      break
  }

  // Pattern-match for dynamic error strings
  if (text.startsWith(API_ERROR_MESSAGE_PREFIX)) {
    if (text.includes('Extra usage is required for 1M context')) {
      return 'Run /extra-usage to enable 1M context, or /model to switch to a standard context model.'
    }

    if (
      text.includes('429') ||
      text.includes('Rate limit') ||
      text.includes('rate_limit')
    ) {
      return 'API rate limit hit — please wait a moment before retrying.'
    }

    if (text.includes('529') || text.includes('overloaded')) {
      return 'Server is overloaded — please wait a moment and retry, or switch models with /model.'
    }

    if (text.includes('credit balance is too low')) {
      return 'Add funds at https://costrict.ai/settings/billing to continue.'
    }

    if (text.includes('tool use')) {
      return 'Run /rewind to recover the conversation, then retry.'
    }

    if (
      text.includes('not available on your') ||
      text.includes('does not have access')
    ) {
      return HINT_MODEL
    }

    // Generic API error fallback
    return HINT_RETRY
  }

  return null
}
