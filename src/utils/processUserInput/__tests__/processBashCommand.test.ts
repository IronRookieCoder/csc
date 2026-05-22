import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources'
import type { ProcessUserInputContext } from '../processUserInput'

let bashCallInputs: Array<{ command: string; dangerouslyDisableSandbox?: boolean }> = []

mock.module('bun:bundle', () => ({ feature: () => false }))

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
  logEventAsync: async () => {},
  attachAnalyticsSink: () => {},
  stripProtoFields: <T>(metadata: T) => metadata,
}))

mock.module('src/components/BashModeProgress.js', () => ({
  BashModeProgress: () => null,
}))

mock.module('src/utils/shell/resolveDefaultShell.js', () => ({
  resolveDefaultShell: () => 'bash',
}))

mock.module('src/utils/shell/shellToolUtils.js', () => ({
  SHELL_TOOL_NAMES: ['Bash', 'PowerShell'],
  isPowerShellToolEnabled: () => false,
}))

mock.module(
  '@claude-code-best/builtin-tools/tools/BashTool/BashTool.js',
  () => ({
    BashTool: {
      name: 'Bash',
      maxResultSizeChars: 10000,
      call: async (input: {
        command: string
        dangerouslyDisableSandbox?: boolean
      }) => {
        bashCallInputs.push(input)
        return {
          data: {
            stdout: 'ok',
            stderr: '',
          },
        }
      },
      mapToolResultToToolResultBlockParam: (
        result: { stdout?: string },
        toolUseId: string,
      ) => ({
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: result.stdout ?? '',
      }),
    },
  }),
)

const { processBashCommand } = await import('../processBashCommand')

function createContext(): ProcessUserInputContext {
  return {
    options: {
      verbose: false,
    },
  } as ProcessUserInputContext
}

beforeEach(() => {
  bashCallInputs = []
})

describe('processBashCommand', () => {
  test('strips a leading bash mode marker before executing and recording command', async () => {
    const result = await processBashCommand(
      '!ls',
      [] as ContentBlockParam[],
      [],
      createContext(),
      mock(() => {}),
    )

    expect(bashCallInputs).toEqual([
      {
        command: 'ls',
        dangerouslyDisableSandbox: true,
      },
    ])
    expect(result.shouldQuery).toBe(false)
    expect(JSON.stringify(result.messages)).toContain(
      '<bash-input>ls</bash-input>',
    )
    expect(JSON.stringify(result.messages)).not.toContain(
      '<bash-input>!ls</bash-input>',
    )
  })

  test('leaves already-normalized bash commands unchanged', async () => {
    await processBashCommand(
      'git status',
      [] as ContentBlockParam[],
      [],
      createContext(),
      mock(() => {}),
    )

    expect(bashCallInputs[0]?.command).toBe('git status')
  })
})
