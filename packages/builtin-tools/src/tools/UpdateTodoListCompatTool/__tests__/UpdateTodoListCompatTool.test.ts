import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

mock.module('bun:bundle', () => ({
  feature: () => false,
}))

mock.module('src/utils/model/providers.js', () => ({
  getAPIProvider: () => 'costrict',
}))

mock.module('src/utils/hooks.js', () => ({
  executeTaskCreatedHooks: async function* () {},
  getTaskCreatedHookMessage: (message: unknown) => String(message),
  executeTaskCompletedHooks: async function* () {},
  getTaskCompletedHookMessage: (message: unknown) => String(message),
}))

mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => false,
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

import { UpdateTodoListCompatTool } from '../UpdateTodoListCompatTool.js'
import {
  getTaskListId,
  listTasks,
  resetTaskList,
} from 'src/utils/tasks.js'
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
const originalTaskListId = process.env.CLAUDE_CODE_TASK_LIST_ID
const originalEnableTasks = process.env.CLAUDE_CODE_ENABLE_TASKS
let tempConfigDir: string

function clearConfigDirCache() {
  getClaudeConfigHomeDir.cache?.clear?.()
}

function createContext() {
  return {
    setAppState: (updater: (state: { expandedView?: string }) => unknown) => {
      updater({})
    },
    abortController: new AbortController(),
  } as never
}

describe('UpdateTodoListCompatTool', () => {
  beforeEach(async () => {
    tempConfigDir = join(tmpdir(), `csc-update-todo-compat-${Date.now()}`)
    await mkdir(tempConfigDir, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
    process.env.CLAUDE_CODE_TASK_LIST_ID = `compat-${Date.now()}`
    process.env.CLAUDE_CODE_ENABLE_TASKS = '1'
    clearConfigDirCache()
    await resetTaskList(getTaskListId())
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    if (originalTaskListId === undefined) {
      delete process.env.CLAUDE_CODE_TASK_LIST_ID
    } else {
      process.env.CLAUDE_CODE_TASK_LIST_ID = originalTaskListId
    }
    if (originalEnableTasks === undefined) {
      delete process.env.CLAUDE_CODE_ENABLE_TASKS
    } else {
      process.env.CLAUDE_CODE_ENABLE_TASKS = originalEnableTasks
    }
    clearConfigDirCache()
    await rm(tempConfigDir, { recursive: true, force: true })
  })

  test('creates tasks from plugin-style markdown checklist statuses', async () => {
    const result = await UpdateTodoListCompatTool.call(
      {
        todos:
          '[ ] 创建任务列表\n[-] 标记第一个任务为完成\n[x] 验证任务列表更新功能正常',
      },
      createContext(),
    )

    expect(result.data.error).toBeUndefined()
    expect(result.data.created).toHaveLength(3)

    const tasks = await listTasks(getTaskListId())
    expect(tasks.map(task => [task.subject, task.status])).toEqual([
      ['创建任务列表', 'pending'],
      ['标记第一个任务为完成', 'in_progress'],
      ['验证任务列表更新功能正常', 'completed'],
    ])
  })

  test('updates existing task status instead of creating duplicates', async () => {
    await UpdateTodoListCompatTool.call(
      {
        todos: '[ ] 创建任务列表\n[ ] 标记第一个任务为完成',
      },
      createContext(),
    )

    const result = await UpdateTodoListCompatTool.call(
      {
        todos: '[x] 创建任务列表\n[-] 标记第一个任务为完成',
      },
      createContext(),
    )

    expect(result.data.created).toHaveLength(0)
    expect(result.data.updated).toHaveLength(2)

    const tasks = await listTasks(getTaskListId())
    expect(tasks).toHaveLength(2)
    expect(tasks.map(task => [task.subject, task.status])).toEqual([
      ['创建任务列表', 'completed'],
      ['标记第一个任务为完成', 'in_progress'],
    ])
  })

  test('returns recoverable error for invalid checklist input', async () => {
    const result = await UpdateTodoListCompatTool.call(
      {
        todos: '创建任务列表\n完成第一项',
      },
      createContext(),
    )

    expect(result.data.created).toHaveLength(0)
    expect(result.data.error).toContain('No valid todo lines found')
    expect(await listTasks(getTaskListId())).toHaveLength(0)
  })

  test('is enabled only for CoStrict TaskV2 sessions', () => {
    expect(UpdateTodoListCompatTool.isEnabled()).toBe(true)
  })

  test('prompt positions checklist sync ahead of low-level task tools', async () => {
    const prompt = await UpdateTodoListCompatTool.prompt()

    expect(prompt).toContain('preferred tool for ordinary todo/checklist')
    expect(prompt).toContain('TaskCreate/TaskUpdate/TaskList/TaskGet')
    expect(prompt).toContain('send the final complete checklist in a single call')
  })
})
