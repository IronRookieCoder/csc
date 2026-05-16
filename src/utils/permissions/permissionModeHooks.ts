/**
 * Permission mode → hooks auto-configuration.
 *
 * Inspired by vibe-kanban's structured PermissionMode + Hooks mapping.
 * Generates the `hooks` configuration for the CLI `initialize` control request
 * based on the selected permission mode.
 *
 * Mode → Hook mapping:
 *
 * | Mode              | Hook behavior                                                     |
 * |-------------------|-------------------------------------------------------------------|
 * | plan              | ExitPlanMode/AskUserQuestion → ask; everything else → auto-allow |
 * | default (approvals) | Read-only tools → auto-allow; rest → ask                        |
 * | acceptEdits       | All file ops → auto-allow; dangerous tools → ask                  |
 * | bypassPermissions | No hooks needed (all permissions skipped)                         |
 * | auto              | No hooks (classifier handles decisions)                            |
 * | dontAsk           | No hooks (ask→deny conversion happens in permission pipeline)      |
 */

import type { PermissionMode } from '../../types/permissions.js'

type HookMatcher = {
  tool_name?: string
}

type HookAction = {
  type: 'allow' | 'deny' | 'ask'
}

type HookConfig = {
  matcher: HookMatcher
  action: HookAction
}

type HooksConfig = {
  PreToolUse?: HookConfig[]
  PostToolUse?: HookConfig[]
  Stop?: HookConfig[]
  Notification?: Array<{ type: string }>
}

const READ_ONLY_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'ToolSearch',
  'LSP',
  'TaskGet',
  'TaskList',
  'WebFetch',
  'WebSearch',
  'McpGet',
  'McpList',
]

const FILE_OPERATION_TOOLS = [
  'Edit',
  'Write',
  'NotebookEdit',
]

const DANGEROUS_TOOLS = [
  'Bash',
  'PowerShell',
]

const PLAN_APPROVAL_TOOLS = [
  'ExitPlanMode',
  'AskUserQuestion',
]

function allowHook(toolName: string): HookConfig {
  return { matcher: { tool_name: toolName }, action: { type: 'allow' } }
}

function askHook(toolName: string): HookConfig {
  return { matcher: { tool_name: toolName }, action: { type: 'ask' } }
}

/**
 * Build hooks configuration for a given permission mode.
 * Returns the hooks object to pass in the CLI `initialize` control request.
 * Returns `undefined` when no hooks are needed (bypass, auto, dontAsk).
 */
export function buildHooksForPermissionMode(mode: PermissionMode): HooksConfig | undefined {
  switch (mode) {
    case 'plan': {
      const preToolUse: HookConfig[] = []
      for (const tool of READ_ONLY_TOOLS) {
        preToolUse.push(allowHook(tool))
      }
      for (const tool of FILE_OPERATION_TOOLS) {
        preToolUse.push(allowHook(tool))
      }
      for (const tool of DANGEROUS_TOOLS) {
        preToolUse.push(askHook(tool))
      }
      for (const tool of PLAN_APPROVAL_TOOLS) {
        preToolUse.push(askHook(tool))
      }
      return { PreToolUse: preToolUse }
    }

    case 'default': {
      const preToolUse: HookConfig[] = []
      for (const tool of READ_ONLY_TOOLS) {
        preToolUse.push(allowHook(tool))
      }
      for (const tool of FILE_OPERATION_TOOLS) {
        preToolUse.push(askHook(tool))
      }
      for (const tool of DANGEROUS_TOOLS) {
        preToolUse.push(askHook(tool))
      }
      return { PreToolUse: preToolUse }
    }

    case 'acceptEdits': {
      const preToolUse: HookConfig[] = []
      for (const tool of READ_ONLY_TOOLS) {
        preToolUse.push(allowHook(tool))
      }
      for (const tool of FILE_OPERATION_TOOLS) {
        preToolUse.push(allowHook(tool))
      }
      for (const tool of DANGEROUS_TOOLS) {
        preToolUse.push(askHook(tool))
      }
      return { PreToolUse: preToolUse }
    }

    case 'bypassPermissions':
    case 'auto':
    case 'dontAsk':
    case 'bubble':
      return undefined
  }
}

/**
 * Merge auto-generated hooks with user-supplied hooks.
 * User hooks take precedence (appended after auto-generated, CLI processes
 * them in order — first match wins in most implementations).
 */
export function mergeHooks(
  autoHooks: HooksConfig | undefined,
  userHooks: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!autoHooks && !userHooks) return undefined
  if (!autoHooks) return userHooks
  if (!userHooks) return autoHooks as unknown as Record<string, unknown>

  const merged: Record<string, unknown> = { ...userHooks }
  for (const [key, value] of Object.entries(autoHooks)) {
    const existing = merged[key]
    if (Array.isArray(existing) && Array.isArray(value)) {
      merged[key] = [...value, ...existing]
    } else if (!(key in merged)) {
      merged[key] = value
    }
  }
  return merged
}
