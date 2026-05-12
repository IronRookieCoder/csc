import { mock, describe, expect, test } from 'bun:test'
import { zodToJsonSchema } from 'src/utils/zodToJsonSchema.js'

// ─── Mocks ───
// Enable FORK_SUBAGENT to match the scenario where the bug manifests.
// Note: due to Bun mock.module isolation across test files, fork field may
// be absent in schema despite isForkSubagentEnabled() returning true.
// The core fix under test is: run_in_background is NOT removed when
// FORK_SUBAGENT is enabled.

mock.module('bun:bundle', () => ({
  feature: (flag: string) => {
    if (flag === 'FORK_SUBAGENT') return true
    if (flag === 'KAIROS') return true
    return false
  },
}))

const noop = () => {}

mock.module('src/constants/xml.js', () => ({ FORK_BOILERPLATE_TAG: '', FORK_DIRECTIVE_PREFIX: '' }))
mock.module('src/bootstrap/state.js', () => ({ getIsNonInteractiveSession: () => false }))
mock.module('src/coordinator/coordinatorMode.js', () => ({ isCoordinatorMode: () => false }))
mock.module('src/utils/debug.js', () => ({ logForDebugging: noop }))
mock.module('src/utils/messages.js', () => ({ createUserMessage: noop }))

import { inputSchema } from '../AgentTool.js'

describe('AgentTool inputSchema — SDD parallel agent fix verification', () => {
  // ─── Core fix: run_in_background must always be accepted ───

  test('accepts run_in_background: true (SDD parallel launch)', () => {
    const result = inputSchema().safeParse({
      description: '生成数据模型设计文档',
      prompt: '设计数据模型...',
      subagent_type: 'general-purpose',
      run_in_background: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).run_in_background).toBe(true)
    }
  })

  test('advertises run_in_background in the API JSON schema', () => {
    const schema = zodToJsonSchema(inputSchema())
    const properties = schema.properties as Record<string, unknown> | undefined
    expect(properties?.run_in_background).toMatchObject({
      type: 'boolean',
    })
  })

  test('accepts run_in_background: "true" string (semanticBoolean)', () => {
    const result = inputSchema().safeParse({
      description: '生成API接口设计文档',
      prompt: '设计API接口...',
      subagent_type: 'general-purpose',
      run_in_background: 'true',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).run_in_background).toBe(true)
    }
  })

  test('accepts run_in_background: "false" string (semanticBoolean)', () => {
    const result = inputSchema().safeParse({
      description: 'test',
      prompt: 'test',
      subagent_type: 'general-purpose',
      run_in_background: 'false',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).run_in_background).toBe(false)
    }
  })

  test('omitting run_in_background yields undefined', () => {
    const result = inputSchema().safeParse({
      description: 'test',
      prompt: 'test',
      subagent_type: 'general-purpose',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).run_in_background).toBeUndefined()
    }
  })

  // ─── SDD exact scenario: two background agents launched in parallel ───

  test('SDD: two parallel design agents both pass validation', () => {
    const agent1 = inputSchema().safeParse({
      description: '生成数据模型设计文档',
      prompt: '设计数据模型...',
      subagent_type: 'general-purpose',
      run_in_background: true,
    })
    const agent2 = inputSchema().safeParse({
      description: '生成API接口设计文档',
      prompt: '设计API接口...',
      subagent_type: 'general-purpose',
      run_in_background: true,
    })
    expect(agent1.success).toBe(true)
    expect(agent2.success).toBe(true)
    if (agent1.success) {
      expect((agent1.data as Record<string, unknown>).run_in_background).toBe(true)
    }
    if (agent2.success) {
      expect((agent2.data as Record<string, unknown>).run_in_background).toBe(true)
    }
  })

  test('SDD: subschema accepts parallel agents without subagent_type (Explore/Plan)', () => {
    // SDD uses Explore and Plan agent types
    for (const agentType of ['general-purpose', 'Explore', 'Plan']) {
      const result = inputSchema().safeParse({
        description: `SDD ${agentType} agent`,
        prompt: 'design task',
        subagent_type: agentType,
        run_in_background: true,
      })
      expect(result.success).toBe(true)
    }
  })

  // ─── Fork parameter basic acceptance ───

  test('fork: true does not cause rejection', () => {
    const result = inputSchema().safeParse({
      description: 'fork test',
      prompt: 'do something',
      fork: true,
    })
    // fork may be stripped from output if schema omits it (mock isolation),
    // but validation must succeed — this is the key behavior.
    expect(result.success).toBe(true)
  })

  test('fork + run_in_background together do not cause rejection', () => {
    const result = inputSchema().safeParse({
      description: 'background fork',
      prompt: 'parallel work',
      fork: true,
      run_in_background: true,
    })
    expect(result.success).toBe(true)
  })

  // ─── Model parameter ───

  test('accepts model: "inherit"', () => {
    const result = inputSchema().safeParse({
      description: 'test',
      prompt: 'test',
      subagent_type: 'general-purpose',
      model: 'inherit',
    })
    expect(result.success).toBe(true)
  })

  test('accepts model: "sonnet" / "opus" / "haiku"', () => {
    for (const m of ['sonnet', 'opus', 'haiku'] as const) {
      const result = inputSchema().safeParse({
        description: 'test',
        prompt: 'test',
        subagent_type: 'general-purpose',
        model: m,
      })
      expect(result.success).toBe(true)
    }
  })

  test('rejects invalid model value', () => {
    const result = inputSchema().safeParse({
      description: 'test',
      prompt: 'test',
      subagent_type: 'general-purpose',
      model: 'gpt-5',
    })
    expect(result.success).toBe(false)
  })

  // ─── Required fields ───

  test('rejects missing description', () => {
    const result = inputSchema().safeParse({
      prompt: 'test',
      subagent_type: 'general-purpose',
    })
    expect(result.success).toBe(false)
  })

  test('rejects missing prompt', () => {
    const result = inputSchema().safeParse({
      description: 'test',
      subagent_type: 'general-purpose',
    })
    expect(result.success).toBe(false)
  })
})
