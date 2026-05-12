import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const agentToolSource = readFileSync(
  join(__dirname, '..', 'AgentTool.tsx'),
  'utf-8',
)

describe('AgentTool input schema source', () => {
  test('accepts inherit as an explicit model option', () => {
    expect(agentToolSource).toContain(
      ".enum(['sonnet', 'opus', 'haiku', 'inherit'])",
    )
  })

  test('uses semantic booleans for background and fork parameters', () => {
    expect(agentToolSource).toContain(
      'run_in_background: semanticBoolean(z.boolean().optional())',
    )
    expect(agentToolSource).toContain(
      'fork: semanticBoolean(z.boolean().optional())',
    )
  })

  test('does not remove run_in_background when fork is enabled', () => {
    expect(agentToolSource).not.toContain(
      'isBackgroundTasksDisabled || isForkSubagentEnabled()',
    )
    expect(agentToolSource).toContain(
      'return isForkSubagentEnabled() ? backgroundSchema : backgroundSchema.omit({ fork: true });',
    )
  })

  test('routes fork only through explicit fork parameter', () => {
    expect(agentToolSource).toContain(
      'const isForkPath = fork === true && isForkSubagentEnabled();',
    )
    expect(agentToolSource).toContain(
      'const effectiveType = subagent_type ?? GENERAL_PURPOSE_AGENT.agentType;',
    )
  })
})
