import { describe, expect, test, mock } from 'bun:test'
import { Hono } from 'hono'
import { createQuestionRoutes } from '../routes/question.js'
import { errorHandler } from '../errors.js'
import type { SessionManager } from '../sessionManager.js'
import type { SessionHandle } from '../sessionHandle.js'

function createMockSessionManager(opts: {
  questions?: Array<{
    requestId: string
    sessionId: string
    mcpServerName: string
    message: string
    mode: string
    requestedSchema: Record<string, unknown>
  }>
  permissions?: Array<{
    requestId: string
    sessionId: string
    toolName: string
    toolUseId: string
    input: Record<string, unknown>
    title: string
    description: string
    suggestions: Record<string, unknown>[]
  }>
  findQuestion?: { handle: SessionHandle; question: unknown } | null
  findPermission?: { handle: SessionHandle; perm: unknown } | null
}): SessionManager {
  return {
    getAllPendingQuestions: () => opts.questions ?? [],
    getAllPendingPermissions: () =>
      opts.permissions?.map((p) => ({
        requestId: p.requestId,
        sessionId: p.sessionId,
        toolName: p.toolName,
        toolUseId: p.toolUseId,
        input: p.input,
        title: p.title,
        description: p.description,
        suggestions: p.suggestions,
      })) ?? [],
    findQuestionAcrossSessions: () => opts.findQuestion ?? null,
    findPermissionAcrossSessions: () => opts.findPermission ?? null,
  } as unknown as SessionManager
}

function createMockHandle(): SessionHandle {
  return {
    replyQuestion: mock(() => {}),
    replyPermission: mock(() => {}),
  } as unknown as SessionHandle
}

describe('createQuestionRoutes', () => {
  describe('GET /question', () => {
    test('returns empty array when no questions', async () => {
      const mgr = createMockSessionManager({})
      const app = createQuestionRoutes(mgr)
      app.onError(errorHandler)
      const res = await app.request('/question')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([])
    })

    test('returns elicitation questions in opencode format', async () => {
      const mgr = createMockSessionManager({
        questions: [
          {
            requestId: 'req-1',
            sessionId: 'sess-1',
            mcpServerName: 'my-server',
            message: 'Please provide API key',
            mode: 'form',
            requestedSchema: {
              type: 'object',
              properties: { key: { type: 'string' } },
            },
          },
        ],
      })
      const app = createQuestionRoutes(mgr)
      app.onError(errorHandler)
      const res = await app.request('/question')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].id).toBe('req-1')
      expect(body[0].sessionID).toBe('sess-1')
      expect(body[0].questions[0].question).toBe('Please provide API key')
      expect(body[0].questions[0].header).toBe('my-server')
      expect(body[0].questions[0].custom).toBe(true)
    })

    test('returns AskUserQuestionTool permissions as questions', async () => {
      const mgr = createMockSessionManager({
        permissions: [
          {
            requestId: 'perm-1',
            sessionId: 'sess-1',
            toolName: 'AskUserQuestionTool',
            toolUseId: 'tu-1',
            input: {
              questions: [
                {
                  question: 'Which library?',
                  header: 'Library',
                  options: [
                    { label: 'A', description: 'Option A' },
                    { label: 'B', description: 'Option B' },
                  ],
                  multiSelect: false,
                },
              ],
            },
            title: 'AskUserQuestionTool',
            description: '',
            suggestions: [],
          },
        ],
      })
      const app = createQuestionRoutes(mgr)
      app.onError(errorHandler)
      const res = await app.request('/question')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].id).toBe('perm-1')
      expect(body[0].questions[0].question).toBe('Which library?')
      expect(body[0].questions[0].options).toHaveLength(2)
      expect(body[0].questions[0].multiple).toBe(false)
      expect(body[0].questions[0].custom).toBe(false)
    })

    test('converts enum schema to options', async () => {
      const mgr = createMockSessionManager({
        questions: [
          {
            requestId: 'req-1',
            sessionId: 'sess-1',
            mcpServerName: 'my-server',
            message: 'Pick region',
            mode: 'form',
            requestedSchema: {
              type: 'object',
              properties: {
                region: {
                  type: 'string',
                  enum: ['us-east-1', 'us-west-2'],
                },
              },
            },
          },
        ],
      })
      const app = createQuestionRoutes(mgr)
      app.onError(errorHandler)
      const res = await app.request('/question')
      const body = await res.json()
      expect(body[0].questions[0].options).toEqual([
        { label: 'us-east-1', description: '' },
        { label: 'us-west-2', description: '' },
      ])
      expect(body[0].questions[0].custom).toBe(false)
    })
  })

  describe('POST /question/:id/reply', () => {
    test('replies to elicitation with parsed content', async () => {
      const handle = createMockHandle()
      const mgr = createMockSessionManager({
        findQuestion: {
          handle,
          question: {
            requestId: 'req-1',
            sessionId: 'sess-1',
            mcpServerName: 'my-server',
            message: 'Please provide API key',
            mode: 'form',
            requestedSchema: {
              type: 'object',
              properties: { key: { type: 'string' } },
            },
          },
        },
      })
      const app = createQuestionRoutes(mgr)
      app.onError(errorHandler)
      const res = await app.request('/question/req-1/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [['my-api-key']] }),
      })
      expect(res.status).toBe(200)
      expect(handle.replyQuestion).toHaveBeenCalledWith(
        'req-1',
        'accept',
        { key: 'my-api-key' },
      )
    })

    test('replies to AskUserQuestionTool permission', async () => {
      const handle = createMockHandle()
      const mgr = createMockSessionManager({
        findPermission: {
          handle,
          perm: {
            requestId: 'perm-1',
            sessionId: 'sess-1',
            toolName: 'AskUserQuestionTool',
            toolUseId: 'tu-1',
            input: {
              questions: [
                { question: 'Which library?', header: 'Library', options: [{ label: 'A', description: '' }] },
              ],
            },
          },
        },
      })
      const app = createQuestionRoutes(mgr)
      app.onError(errorHandler)
      const res = await app.request('/question/perm-1/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [['A']] }),
      })
      expect(res.status).toBe(200)
      expect(handle.replyPermission).toHaveBeenCalledWith(
        'perm-1',
        'allow',
        {
          updatedInput: expect.objectContaining({
            answers: { 'Which library?': 'A' },
          }),
        },
      )
    })

    test('returns 404 for unknown request', async () => {
      const mgr = createMockSessionManager({})
      const app = createQuestionRoutes(mgr)
      app.onError(errorHandler)
      const res = await app.request('/question/unknown/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [[]] }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /question/:id/reject', () => {
    test('rejects elicitation', async () => {
      const handle = createMockHandle()
      const mgr = createMockSessionManager({
        findQuestion: {
          handle,
          question: { requestId: 'req-1' },
        },
      })
      const app = createQuestionRoutes(mgr)
      app.onError(errorHandler)
      const res = await app.request('/question/req-1/reject', { method: 'POST' })
      expect(res.status).toBe(200)
      expect(handle.replyQuestion).toHaveBeenCalledWith('req-1', 'decline')
    })

    test('rejects AskUserQuestionTool permission', async () => {
      const handle = createMockHandle()
      const mgr = createMockSessionManager({
        findPermission: {
          handle,
          perm: {
            requestId: 'perm-1',
            toolName: 'AskUserQuestionTool',
          },
        },
      })
      const app = createQuestionRoutes(mgr)
      app.onError(errorHandler)
      const res = await app.request('/question/perm-1/reject', { method: 'POST' })
      expect(res.status).toBe(200)
      expect(handle.replyPermission).toHaveBeenCalledWith('perm-1', 'deny')
    })
  })
})
