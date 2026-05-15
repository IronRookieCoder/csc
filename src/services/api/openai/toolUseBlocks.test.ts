import { describe, expect, test } from 'bun:test'
import { getFinalContentBlocks } from './toolUseBlocks.js'
import type { Tools } from '../../../Tool.js'

const requiredInputTool = {
  name: 'TaskUpdate',
  inputSchema: {
    safeParse: (input: Record<string, unknown>) => ({
      success: typeof input.taskId === 'string',
    }),
  },
}

const emptyInputTool = {
  name: 'TaskList',
  inputSchema: {
    safeParse: () => ({ success: true }),
  },
}

const tools = [requiredInputTool, emptyInputTool] as unknown as Tools

describe('getFinalContentBlocks', () => {
  test('drops empty tool-use blocks that cannot satisfy the target schema', () => {
    const blocks = getFinalContentBlocks(
      {
        0: {
          type: 'tool_use',
          id: 'empty-task-update',
          name: 'TaskUpdate',
          input: '',
        },
        1: {
          type: 'tool_use',
          id: 'valid-task-update',
          name: 'TaskUpdate',
          input: '{"taskId":"3","status":"completed"}',
        },
      },
      tools,
    )

    expect(blocks).toEqual([
      {
        type: 'tool_use',
        id: 'valid-task-update',
        name: 'TaskUpdate',
        input: '{"taskId":"3","status":"completed"}',
      },
    ])
  })

  test('keeps empty tool-use blocks for tools that accept empty input', () => {
    const blocks = getFinalContentBlocks(
      {
        0: {
          type: 'tool_use',
          id: 'task-list',
          name: 'TaskList',
          input: '',
        },
      },
      tools,
    )

    expect(blocks).toEqual([
      {
        type: 'tool_use',
        id: 'task-list',
        name: 'TaskList',
        input: '',
      },
    ])
  })

  test('keeps a lone stringified empty invalid tool-use block so validation can surface an error', () => {
    const blocks = getFinalContentBlocks(
      {
        0: {
          type: 'tool_use',
          id: 'empty-json-task-update',
          name: 'TaskUpdate',
          input: '{}',
        },
      },
      tools,
    )

    expect(blocks).toEqual([
      {
        type: 'tool_use',
        id: 'empty-json-task-update',
        name: 'TaskUpdate',
        input: '{}',
      },
    ])
  })

  test('keeps a lone empty invalid tool-use block so validation can surface an error', () => {
    const blocks = getFinalContentBlocks(
      {
        0: {
          type: 'tool_use',
          id: 'empty-object-task-update',
          name: 'TaskUpdate',
          input: {},
        },
      },
      tools,
    )

    expect(blocks).toEqual([
      {
        type: 'tool_use',
        id: 'empty-object-task-update',
        name: 'TaskUpdate',
        input: {},
      },
    ])
  })

  test('keeps unknown tool-use blocks and preserves content order', () => {
    const blocks = getFinalContentBlocks(
      {
        2: { type: 'text', text: 'done' },
        1: {
          type: 'tool_use',
          id: 'unknown',
          name: 'UnknownTool',
          input: '',
        },
      },
      tools,
    )

    expect(blocks).toEqual([
      {
        type: 'tool_use',
        id: 'unknown',
        name: 'UnknownTool',
        input: '',
      },
      { type: 'text', text: 'done' },
    ])
  })
})
