import { describe, expect, test } from 'bun:test'
import type {
  AgentDefinition,
  AgentDefinitionsResult,
} from '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { mergeRefreshedAgentDefinitions } from '../AgentsMenu.js'

function makeAgent(
  agentType: string,
  source: AgentDefinition['source'],
): AgentDefinition {
  return {
    agentType,
    source,
    whenToUse: `${agentType} description`,
    getSystemPrompt: () => `${agentType} prompt`,
    ...(source === 'built-in' ? { baseDir: 'built-in' as const } : {}),
    ...(source === 'plugin' ? { plugin: 'test-plugin' } : {}),
  } as AgentDefinition
}

function makeDefinitions(
  allAgents: AgentDefinition[],
  extra?: Partial<AgentDefinitionsResult>,
): AgentDefinitionsResult {
  return {
    allAgents,
    activeAgents: allAgents,
    ...extra,
  }
}

describe('mergeRefreshedAgentDefinitions', () => {
  test('replaces stale built-in-only state with all refreshed agent layers', () => {
    const current = makeDefinitions([makeAgent('general-purpose', 'built-in')])
    const refreshed = makeDefinitions([
      makeAgent('general-purpose', 'built-in'),
      makeAgent('plugin-reviewer', 'plugin'),
      makeAgent('user-reviewer', 'userSettings'),
      makeAgent('project-reviewer', 'projectSettings'),
      makeAgent('local-reviewer', 'localSettings'),
      makeAgent('managed-reviewer', 'policySettings'),
    ])

    const merged = mergeRefreshedAgentDefinitions(current, refreshed)

    expect(merged.allAgents.map(agent => agent.source)).toEqual([
      'built-in',
      'plugin',
      'userSettings',
      'projectSettings',
      'localSettings',
      'policySettings',
    ])
    expect(merged.activeAgents.map(agent => agent.agentType)).toContain(
      'project-reviewer',
    )
  })

  test('preserves CLI flag agents and allowed agent filters across refresh', () => {
    const flagAgent = makeAgent('cli-reviewer', 'flagSettings')
    const current = makeDefinitions(
      [makeAgent('general-purpose', 'built-in'), flagAgent],
      { allowedAgentTypes: ['cli-reviewer'] },
    )
    const refreshed = makeDefinitions([
      makeAgent('general-purpose', 'built-in'),
      makeAgent('project-reviewer', 'projectSettings'),
    ])

    const merged = mergeRefreshedAgentDefinitions(current, refreshed)

    expect(merged.allAgents.map(agent => agent.agentType)).toEqual([
      'general-purpose',
      'project-reviewer',
      'cli-reviewer',
    ])
    expect(merged.activeAgents.map(agent => agent.agentType)).toContain(
      'cli-reviewer',
    )
    expect(merged.allowedAgentTypes).toEqual(['cli-reviewer'])
  })
})
