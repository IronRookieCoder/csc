import { describe, expect, mock, test } from 'bun:test'
import { z } from 'zod/v4'

mock.module('bun:bundle', () => ({
  feature: () => false,
}))

mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => false,
}))

mock.module('src/utils/hooks.js', () => ({
  executeTaskCompletedHooks: async function* () {},
  getTaskCompletedHookMessage: (message: unknown) => String(message),
}))

mock.module('src/utils/tasks.js', () => ({
  blockTask: async () => true,
  deleteTask: async () => true,
  getTask: async () => null,
  getTaskListId: () => 'test-list',
  isTodoV2Enabled: () => true,
  listTasks: async () => [],
  TaskStatusSchema: () => z.enum(['pending', 'in_progress', 'completed']),
  updateTask: async () => null,
}))

mock.module('src/utils/agentSwarmsEnabled.js', () => ({
  isAgentSwarmsEnabled: () => false,
}))

mock.module('src/utils/teammate.js', () => ({
  getAgentId: () => undefined,
  getAgentName: () => undefined,
  getTeammateColor: () => undefined,
  getTeamName: () => undefined,
}))

mock.module('src/utils/teammateMailbox.js', () => ({
  writeToMailbox: async () => undefined,
}))

import { TaskUpdateTool } from '../TaskUpdateTool.js'

describe('TaskUpdateTool inputSchema', () => {
  test('normalizes legacy status aliases', () => {
    const schema = TaskUpdateTool.inputSchema

    for (const [inputStatus, expectedStatus] of [
      ['open', 'pending'],
      ['in progress', 'in_progress'],
      ['resolved', 'completed'],
      ['done', 'completed'],
      ['removed', 'deleted'],
    ] as const) {
      const result = schema.safeParse({
        taskId: '1',
        status: inputStatus,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe(expectedStatus)
      }
    }
  })

  test('normalizes common field aliases before strict validation', () => {
    const result = TaskUpdateTool.inputSchema.safeParse({
      task_id: 1,
      status: 'resolved',
      active_form: 'Running tests',
      blocks: ['3'],
      blocked_by: ['2'],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({
        taskId: '1',
        status: 'completed',
        activeForm: 'Running tests',
        addBlocks: ['3'],
        addBlockedBy: ['2'],
      })
    }
  })

  test('still rejects unrelated unknown fields', () => {
    const result = TaskUpdateTool.inputSchema.safeParse({
      taskId: '1',
      status: 'completed',
      unexpected: true,
    })

    expect(result.success).toBe(false)
  })
})
