import { describe, expect, test } from 'bun:test'
import { deriveTopBarState, type TopBarInput } from '../topBar'

function toolUse(
  uuid: string,
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): any {
  return toolUseWithMessageID(uuid, `msg-${uuid}`, id, name, input)
}

function toolUseWithMessageID(
  uuid: string,
  messageID: string,
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): any {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-05-26T00:00:00.000Z',
    message: {
      id: messageID,
      content: [{ type: 'tool_use', id, name, input }],
    },
  }
}

function toolResult(uuid: string, id: string, isError = false): any {
  return {
    type: 'user',
    uuid,
    timestamp: '2026-05-26T00:00:00.000Z',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: 'ok',
          is_error: isError,
        },
      ],
    },
  }
}

function assistantWithToolUses(
  uuid: string,
  blocks: Array<{ id: string; name: string; input?: Record<string, unknown> }>,
): any {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-05-26T00:00:00.000Z',
    message: {
      id: `msg-${uuid}`,
      content: blocks.map(block => ({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input ?? {},
      })),
    },
  }
}

function userWithToolResults(
  uuid: string,
  blocks: Array<{ id: string; isError?: boolean }>,
): any {
  return {
    type: 'user',
    uuid,
    timestamp: '2026-05-26T00:00:00.000Z',
    message: {
      content: blocks.map(block => ({
        type: 'tool_result',
        tool_use_id: block.id,
        content: 'ok',
        is_error: block.isError === true,
      })),
    },
  }
}

function derive(input: Partial<TopBarInput>) {
  return deriveTopBarState({
    messages: input.messages ?? [],
    inProgressToolUseIDs: input.inProgressToolUseIDs ?? new Set<string>(),
    sessionTitle: input.sessionTitle ?? 'Fix login timeout',
    branch: input.branch ?? 'docs/csc-ui-redesign',
    brandVersion: input.brandVersion ?? 'CoStrict v4.0.13',
    columns: input.columns ?? 140,
  })
}

describe('deriveTopBarState', () => {
  test('uses idle mode when no tool is running', () => {
    const state = derive({})

    expect(state.mode).toBe('idle')
    expect(state.sessionTitle).toBe('Fix login timeout')
    expect(state.branch).toBe('docs/csc-ui-redesign')
    expect(state.brandVersion).toBe('CoStrict v4.0.13')
    expect(state.pipeline.map(phase => phase.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
    ])
    expect(state.layout.kind).toBe('full')
  })

  test('uses active mode when a tool is running', () => {
    const state = derive({
      messages: [
        toolUse('a1', 'toolu_read', 'Read', { file_path: 'src/main.tsx' }),
      ],
      inProgressToolUseIDs: new Set(['toolu_read']),
    })

    expect(state.mode).toBe('active')
    expect(state.pipeline).toContainEqual({
      id: 'context',
      title: 'Context',
      status: 'running',
      detail: 'src/main.tsx',
    })
  })

  test('maps read locate edit and verification tools into ordered pipeline phases', () => {
    const state = derive({
      messages: [
        toolUse('a1', 'toolu_read', 'Grep', { pattern: 'timeout' }),
        toolResult('u1', 'toolu_read'),
        toolUse('a2', 'toolu_edit', 'Edit', { file_path: 'src/login.ts' }),
        toolResult('u2', 'toolu_edit'),
        toolUse('a3', 'toolu_test', 'Bash', { command: 'bun run typecheck' }),
      ],
      inProgressToolUseIDs: new Set(['toolu_test']),
    })

    expect(
      state.pipeline.map(phase => [phase.id, phase.title, phase.status]),
    ).toEqual([
      ['context', 'Context', 'pending'],
      ['locate', 'Locate', 'done'],
      ['edit', 'Changes', 'done'],
      ['verify', 'Verify', 'running'],
    ])
    expect(state.pipeline[3]?.detail).toBe('bun run typecheck')
  })

  test('keeps verification attention after a failed command', () => {
    const state = derive({
      messages: [
        toolUse('a1', 'toolu_test', 'Bash', { command: 'bun test' }),
        toolResult('u1', 'toolu_test', true),
      ],
    })

    expect(state.pipeline).toContainEqual({
      id: 'verify',
      title: 'Verify',
      status: 'attention',
      detail: 'bun test',
    })
  })

  test('treats common verification commands as verification commands', () => {
    const state = derive({
      messages: [
        assistantWithToolUses('a1', [
          {
            id: 'toolu_vitest',
            name: 'Bash',
            input: { command: 'bunx vitest run' },
          },
          {
            id: 'toolu_eslint',
            name: 'Bash',
            input: { command: 'bunx eslint .' },
          },
        ]),
      ],
      inProgressToolUseIDs: new Set(['toolu_vitest']),
    })

    expect(state.pipeline).toContainEqual({
      id: 'verify',
      title: 'Verify',
      status: 'running',
      detail: 'bunx vitest run',
    })
  })

  test('maps biome check commands into verify phase without mapping format writes', () => {
    const verify = derive({
      messages: [
        toolUse('a1', 'toolu_biome', 'Bash', {
          command: 'bunx biome check src/utils/topBar.ts',
        }),
      ],
      inProgressToolUseIDs: new Set(['toolu_biome']),
    })
    const format = derive({
      messages: [
        toolUse('a2', 'toolu_format', 'Bash', {
          command: 'bunx biome format --write src/utils/topBar.ts',
        }),
      ],
      inProgressToolUseIDs: new Set(['toolu_format']),
    })
    const directFormat = derive({
      messages: [
        toolUse('a3', 'toolu_direct_format', 'Bash', {
          command: 'biome format --write src/utils/topBar.ts',
        }),
      ],
      inProgressToolUseIDs: new Set(['toolu_direct_format']),
    })
    const checkWrite = derive({
      messages: [
        toolUse('a4', 'toolu_check_write', 'Bash', {
          command: 'bunx biome check --write src/utils/topBar.ts',
        }),
      ],
      inProgressToolUseIDs: new Set(['toolu_check_write']),
    })

    expect(verify.pipeline).toContainEqual({
      id: 'verify',
      title: 'Verify',
      status: 'running',
      detail: 'bunx biome check src/utils/topBar.ts',
    })
    expect(format.mode).toBe('active')
    expect(format.pipeline).toContainEqual({
      id: 'verify',
      title: 'Verify',
      status: 'pending',
    })
    expect(directFormat.mode).toBe('active')
    expect(directFormat.pipeline).toContainEqual({
      id: 'verify',
      title: 'Verify',
      status: 'pending',
    })
    expect(checkWrite.mode).toBe('active')
    expect(checkWrite.pipeline).toContainEqual({
      id: 'verify',
      title: 'Verify',
      status: 'pending',
    })
  })

  test('does not treat incidental verification words as verification commands', () => {
    const commands = [
      'echo contest results',
      'cat docs/building.md',
      'grep build src/foo.ts',
      'test -f package.json',
      'bun run lint:fix',
      'bunx eslint --fix .',
      'bun run lint -- --fix',
      'yarn lint --fix',
    ]

    for (const command of commands) {
      const state = derive({
        messages: [toolUse('a1', 'toolu_bash', 'Bash', { command })],
        inProgressToolUseIDs: new Set(['toolu_bash']),
      })

      expect(state.mode).toBe('active')
      expect(state.pipeline).toContainEqual({
        id: 'verify',
        title: 'Verify',
        status: 'pending',
      })
    }
  })

  test('maps powershell verification commands into verify phase', () => {
    const state = derive({
      messages: [
        toolUse('a1', 'toolu_ps', 'PowerShell', {
          command: 'bun run typecheck',
        }),
      ],
      inProgressToolUseIDs: new Set(['toolu_ps']),
    })

    expect(state.pipeline).toContainEqual({
      id: 'verify',
      title: 'Verify',
      status: 'running',
      detail: 'bun run typecheck',
    })
  })

  test('maps tsc package scripts and make targets into verify phase', () => {
    const commands = [
      'bun run tsc',
      'npm run tsc',
      'pnpm tsc',
      'yarn tsc',
      'make tsc',
    ]

    for (const command of commands) {
      const state = derive({
        messages: [toolUse('a1', 'toolu_tsc', 'Bash', { command })],
        inProgressToolUseIDs: new Set(['toolu_tsc']),
      })

      expect(state.pipeline).toContainEqual({
        id: 'verify',
        title: 'Verify',
        status: 'running',
        detail: command,
      })
    }
  })

  test('keeps detail from the highest priority tool status in a phase', () => {
    const state = derive({
      messages: [
        toolUse('a1', 'toolu_test', 'Bash', { command: 'bun test' }),
        toolResult('u1', 'toolu_test', true),
        toolUse('a2', 'toolu_typecheck', 'Bash', {
          command: 'bun run typecheck',
        }),
        toolResult('u2', 'toolu_typecheck'),
      ],
    })

    expect(state.pipeline).toContainEqual({
      id: 'verify',
      title: 'Verify',
      status: 'attention',
      detail: 'bun test',
    })
  })

  test('does not fill missing high priority detail from a lower priority tool', () => {
    const state = derive({
      messages: [
        toolUse('a1', 'toolu_failed_edit', 'Edit'),
        toolResult('u1', 'toolu_failed_edit', true),
        toolUse('a2', 'toolu_success_edit', 'Edit', {
          file_path: 'src/login.ts',
        }),
        toolResult('u2', 'toolu_success_edit'),
      ],
    })
    const editPhase = state.pipeline.find(phase => phase.id === 'edit')

    expect(editPhase).toEqual({
      id: 'edit',
      title: 'Changes',
      status: 'attention',
    })
  })

  test('clears lower priority detail when a later high priority tool has no detail', () => {
    const state = derive({
      messages: [
        toolUse('a1', 'toolu_success_edit', 'Edit', {
          file_path: 'src/login.ts',
        }),
        toolResult('u1', 'toolu_success_edit'),
        toolUse('a2', 'toolu_failed_edit', 'Edit'),
        toolResult('u2', 'toolu_failed_edit', true),
      ],
    })
    const editPhase = state.pipeline.find(phase => phase.id === 'edit')

    expect(editPhase).toEqual({
      id: 'edit',
      title: 'Changes',
      status: 'attention',
    })
  })

  test('keeps running detail when a later pending tool belongs to the same phase', () => {
    const state = derive({
      messages: [
        assistantWithToolUses('a1', [
          {
            id: 'toolu_read',
            name: 'Read',
            input: { file_path: 'src/main.tsx' },
          },
          { id: 'toolu_grep', name: 'Grep', input: { pattern: 'timeout' } },
        ]),
      ],
      inProgressToolUseIDs: new Set(['toolu_read']),
    })

    expect(state.pipeline).toContainEqual({
      id: 'context',
      title: 'Context',
      status: 'running',
      detail: 'src/main.tsx',
    })
  })

  test('completed results take precedence over stale in-progress ids', () => {
    const state = derive({
      messages: [
        toolUse('a1', 'toolu_read', 'Read', { file_path: 'src/main.tsx' }),
        toolResult('u1', 'toolu_read'),
        toolUse('a2', 'toolu_test', 'Bash', { command: 'bun test' }),
        toolResult('u2', 'toolu_test', true),
      ],
      inProgressToolUseIDs: new Set(['toolu_read', 'toolu_test']),
    })

    expect(state.pipeline).toContainEqual({
      id: 'context',
      title: 'Context',
      status: 'done',
      detail: 'src/main.tsx',
    })
    expect(state.pipeline).toContainEqual({
      id: 'verify',
      title: 'Verify',
      status: 'attention',
      detail: 'bun test',
    })
    expect(state.mode).toBe('idle')
  })

  test('orphan in-progress ids do not activate the top bar', () => {
    const state = derive({
      messages: [],
      inProgressToolUseIDs: new Set(['toolu_missing']),
    })

    expect(state.mode).toBe('idle')
    expect(state.pipeline.map(phase => phase.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
    ])
  })

  test('in-progress ids in the latest tool batch activate the top bar', () => {
    const state = derive({
      messages: [
        assistantWithToolUses('a1', [
          {
            id: 'toolu_read',
            name: 'Read',
            input: { file_path: 'src/main.tsx' },
          },
          { id: 'toolu_grep', name: 'Grep', input: { pattern: 'timeout' } },
        ]),
      ],
      inProgressToolUseIDs: new Set(['toolu_read']),
    })

    expect(state.mode).toBe('active')
    expect(state.pipeline).toContainEqual({
      id: 'context',
      title: 'Context',
      status: 'running',
      detail: 'src/main.tsx',
    })
  })

  test('in-progress ids in split messages with the same assistant message id stay active', () => {
    const state = derive({
      messages: [
        toolUseWithMessageID('a1', 'msg-shared', 'toolu_read', 'Read', {
          file_path: 'src/main.tsx',
        }),
        toolUseWithMessageID('a2', 'msg-shared', 'toolu_edit', 'Edit', {
          file_path: 'src/main.tsx',
        }),
      ],
      inProgressToolUseIDs: new Set(['toolu_read']),
    })

    expect(state.mode).toBe('active')
    expect(state.pipeline).toContainEqual({
      id: 'context',
      title: 'Context',
      status: 'running',
      detail: 'src/main.tsx',
    })
  })

  test('older unresolved tool_use ids do not activate the top bar', () => {
    const state = derive({
      messages: [
        toolUse('a1', 'toolu_old', 'Read', { file_path: 'src/old.ts' }),
        toolUse('a2', 'toolu_new', 'Read', { file_path: 'src/new.ts' }),
        toolResult('u1', 'toolu_new'),
      ],
      inProgressToolUseIDs: new Set(['toolu_old']),
    })

    expect(state.mode).toBe('idle')
    expect(state.pipeline).toContainEqual({
      id: 'context',
      title: 'Context',
      status: 'done',
      detail: 'src/new.ts',
    })
  })

  test('collects multiple tool_use and tool_result blocks from one message', () => {
    const state = derive({
      messages: [
        assistantWithToolUses('a1', [
          {
            id: 'toolu_read',
            name: 'Read',
            input: { file_path: 'src/main.tsx' },
          },
          {
            id: 'toolu_edit',
            name: 'Edit',
            input: { file_path: 'src/main.tsx' },
          },
        ]),
        userWithToolResults('u1', [
          { id: 'toolu_read' },
          { id: 'toolu_edit', isError: true },
        ]),
      ],
    })

    expect(state.pipeline).toContainEqual({
      id: 'context',
      title: 'Context',
      status: 'done',
      detail: 'src/main.tsx',
    })
    expect(state.pipeline).toContainEqual({
      id: 'edit',
      title: 'Changes',
      status: 'attention',
      detail: 'src/main.tsx',
    })
  })

  test('uses compact single and minimal layouts based on columns', () => {
    expect(derive({ columns: 130 }).layout.kind).toBe('compact')
    expect(derive({ columns: 100 }).layout.kind).toBe('single')
    expect(derive({ columns: 70 }).layout.kind).toBe('minimal')
  })
})
