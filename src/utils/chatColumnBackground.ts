import { getDesignTokens, type DesignTokenColor } from './designTokens.js'
import type { TerminalCapabilities } from './terminalCapabilities.js'

export function getChatColumnBackgroundColor(
  theme: string,
  capabilities: TerminalCapabilities,
): DesignTokenColor {
  return getDesignTokens(theme, capabilities).surface
}
