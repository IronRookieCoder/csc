import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  getTaskListId,
  isTodoV2Enabled,
  listTasks,
  type TaskStatus,
} from 'src/utils/tasks.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { TaskCreateTool } from '../TaskCreateTool/TaskCreateTool.js'
import { TaskUpdateTool } from '../TaskUpdateTool/TaskUpdateTool.js'
import { UPDATE_TODO_LIST_COMPAT_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

type ParsedTodo = {
  subject: string
  status: TaskStatus
}

type SyncedTodo = ParsedTodo & {
  taskId: string
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    todos: z
      .string()
      .min(1)
      .describe('Full markdown checklist using [ ], [-], [x] markers'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    created: z.array(
      z.object({
        taskId: z.string(),
        subject: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed']),
      }),
    ),
    updated: z.array(
      z.object({
        taskId: z.string(),
        subject: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed']),
      }),
    ),
    unchanged: z.array(
      z.object({
        taskId: z.string(),
        subject: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed']),
      }),
    ),
    ignoredLines: z.array(z.string()),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

function normalizeSubject(subject: string): string {
  return subject.trim().replace(/\s+/g, ' ')
}

function toActiveForm(subject: string): string {
  return subject
}

function parseTodoLine(line: string): ParsedTodo | null {
  const match = line.match(/^\s*\[( |-|x|X)\]\s+(.+?)\s*$/)
  if (!match) return null

  const marker = match[1]
  const subject = normalizeSubject(match[2] ?? '')
  if (!subject) return null

  const status: TaskStatus =
    marker === ' '
      ? 'pending'
      : marker === '-'
        ? 'in_progress'
        : 'completed'

  return { subject, status }
}

function parseTodos(todos: string): {
  parsed: ParsedTodo[]
  ignoredLines: string[]
} {
  const parsed: ParsedTodo[] = []
  const ignoredLines: string[] = []
  const seenSubjects = new Set<string>()

  for (const rawLine of todos.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    const todo = parseTodoLine(rawLine)
    if (!todo) {
      ignoredLines.push(rawLine)
      continue
    }

    const key = todo.subject.toLowerCase()
    if (seenSubjects.has(key)) continue
    seenSubjects.add(key)
    parsed.push(todo)
  }

  return { parsed, ignoredLines }
}

export const UpdateTodoListCompatTool = buildTool({
  name: UPDATE_TODO_LIST_COMPAT_TOOL_NAME,
  searchHint:
    'preferred CoStrict tool to create or update a markdown task checklist',
  maxResultSizeChars: 100_000,
  alwaysLoad: true,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'UpdateTodoList'
  },
  isEnabled() {
    return getAPIProvider() === 'costrict' && isTodoV2Enabled()
  },
  isConcurrencySafe() {
    return false
  },
  toAutoClassifierInput(input) {
    return input.todos
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage() {
    return null
  },
  async call({ todos }, context) {
    const { parsed, ignoredLines } = parseTodos(todos)
    if (parsed.length === 0) {
      return {
        data: {
          created: [],
          updated: [],
          unchanged: [],
          ignoredLines,
          error:
            'No valid todo lines found. Use [ ], [-], or [x] markers followed by task text.',
        },
      }
    }

    const existingTasks = await listTasks(getTaskListId())
    const existingBySubject = new Map(
      existingTasks.map(task => [
        normalizeSubject(task.subject).toLowerCase(),
        task,
      ]),
    )

    const created: SyncedTodo[] = []
    const updated: SyncedTodo[] = []
    const unchanged: SyncedTodo[] = []

    for (const todo of parsed) {
      const key = todo.subject.toLowerCase()
      const existing = existingBySubject.get(key)

      if (!existing) {
        const result = await TaskCreateTool.call(
          {
            subject: todo.subject,
            description: todo.subject,
            activeForm: toActiveForm(todo.subject),
            metadata: { costrictCompatTodo: true },
          },
          context,
        )
        const taskId = result.data.task.id
        let syncedStatus: TaskStatus = 'pending'

        if (todo.status !== 'pending') {
          const updateResult = await TaskUpdateTool.call(
            {
              taskId,
              status: todo.status,
            },
            context,
          )
          if (!updateResult.data.success) {
            ignoredLines.push(
              `[${todo.status}] ${todo.subject}: ${updateResult.data.error ?? 'Task status update failed'}`,
            )
          } else {
            syncedStatus = todo.status
          }
        }

        const synced = {
          taskId,
          subject: todo.subject,
          status: syncedStatus,
        }
        created.push(synced)
        existingBySubject.set(key, {
          id: taskId,
          subject: todo.subject,
          description: todo.subject,
          activeForm: toActiveForm(todo.subject),
          owner: undefined,
          status: syncedStatus,
          blocks: [],
          blockedBy: [],
          metadata: { costrictCompatTodo: true },
        })
        continue
      }

      if (existing.status === todo.status) {
        unchanged.push({
          taskId: existing.id,
          subject: existing.subject,
          status: existing.status,
        })
        continue
      }

      const result = await TaskUpdateTool.call(
        {
          taskId: existing.id,
          status: todo.status,
        },
        context,
      )

      if (result.data.success) {
        updated.push({
          taskId: existing.id,
          subject: existing.subject,
          status: todo.status,
        })
      } else {
        ignoredLines.push(
          `[${todo.status}] ${todo.subject}: ${result.data.error ?? 'Task status update failed'}`,
        )
      }
    }

    return {
      data: {
        created,
        updated,
        unchanged,
        ignoredLines,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { created, updated, unchanged, ignoredLines, error } =
      content as Output

    if (error) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: error,
      }
    }

    const lines = [
      'Todo list updated successfully.',
      `Created: ${created.length}; Updated: ${updated.length}; Unchanged: ${unchanged.length}.`,
    ]

    if (ignoredLines.length > 0) {
      lines.push(`Ignored lines: ${ignoredLines.length}.`)
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
