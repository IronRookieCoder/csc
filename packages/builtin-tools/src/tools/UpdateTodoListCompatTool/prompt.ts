export const DESCRIPTION =
  'Preferred CoStrict tool for creating and updating a simple task checklist from markdown.'

export const PROMPT = `Use this tool to create or update the current task checklist in CoStrict.

This is the preferred tool for ordinary todo/checklist progress tracking, especially when the user asks to create a task list, update task statuses, mark items complete, or verify that task list updates work.

Use the lower-level TaskCreate/TaskUpdate/TaskList/TaskGet tools only when you need structured task-management features such as owner assignment, dependencies, teammate workflows, reading a specific task by ID, task output, or stopping background tasks.

Provide the complete checklist every time in the todos string. Each non-empty line must use one of these markers:
- [ ] pending task
- [-] task currently in progress
- [x] completed task

The tool creates missing tasks and updates the status of existing tasks with the same text. If the user asks to create a list and mark it complete in one request, send the final complete checklist in a single call.`
