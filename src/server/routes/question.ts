import { Hono } from 'hono'
import type { SessionManager } from '../sessionManager.js'
import { notFound } from '../errors.js'

// ============================================================================
// Opencode-compatible Question Types
// ============================================================================

type QuestionOption = {
  label: string
  description: string
}

type QuestionInfo = {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

type QuestionRequest = {
  id: string
  sessionID: string
  questions: QuestionInfo[]
}

type QuestionReplyBody = {
  answers: string[][]
}

// ============================================================================
// Conversion helpers
// ============================================================================

function convertAskUserQuestionToOpencode(
  requestId: string,
  sessionId: string,
  input: Record<string, unknown>,
): QuestionRequest {
  const questions = (input.questions as Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiSelect?: boolean
  }>) ?? []

  return {
    id: requestId,
    sessionID: sessionId,
    questions: questions.map(q => ({
      question: q.question,
      header: q.header,
      options: q.options.map(o => ({
        label: o.label,
        description: o.description,
      })),
      multiple: q.multiSelect ?? false,
      custom: false,
    })),
  }
}

function convertElicitationToOpencode(
  requestId: string,
  sessionId: string,
  message: string,
  mcpServerName: string,
  requestedSchema: Record<string, unknown>,
): QuestionRequest {
  // Try to extract enum options from schema properties for better UX
  const properties = requestedSchema.properties as Record<string, { enum?: string[]; type?: string }> | undefined
  let options: QuestionOption[] = []
  let custom = true

  if (properties && Object.keys(properties).length === 1) {
    const singleProp = Object.values(properties)[0]
    if (singleProp.enum && singleProp.enum.length > 0) {
      options = singleProp.enum.map(label => ({ label, description: '' }))
      custom = false
    }
  }

  return {
    id: requestId,
    sessionID: sessionId,
    questions: [{
      question: message,
      header: mcpServerName || 'MCP',
      options,
      multiple: false,
      custom,
    }],
  }
}

function buildElicitationContent(
  requestedSchema: Record<string, unknown>,
  answers: string[][],
): Record<string, unknown> {
  const answerText = answers[0]?.[0] ?? ''
  if (!answerText) return {}

  const properties = requestedSchema.properties as Record<string, { type?: string; enum?: string[] }> | undefined
  if (properties && Object.keys(properties).length === 1) {
    const key = Object.keys(properties)[0]
    const prop = properties[key]
    if (prop.type === 'string' && prop.enum && prop.enum.includes(answerText)) {
      return { [key]: answerText }
    }
    if (prop.type === 'boolean' && (answerText === 'true' || answerText === 'false')) {
      return { [key]: answerText === 'true' }
    }
    if (prop.type === 'number') {
      const num = Number(answerText)
      if (!Number.isNaN(num)) return { [key]: num }
    }
    return { [key]: answerText }
  }

  // Fallback: try to parse as JSON for complex schemas
  try {
    return JSON.parse(answerText) as Record<string, unknown>
  } catch {
    return { answer: answerText }
  }
}

// ============================================================================
// Routes
// ============================================================================

export function createQuestionRoutes(sessionManager: SessionManager): Hono {
  return new Hono()
    .get('/question', c => {
      const result: QuestionRequest[] = []

      // 1. Elicitation questions (MCP)
      for (const q of sessionManager.getAllPendingQuestions()) {
        result.push(convertElicitationToOpencode(
          q.requestId,
          q.sessionId,
          q.message,
          q.mcpServerName,
          q.requestedSchema,
        ))
      }

      // 2. AskUserQuestionTool permissions exposed as questions
      for (const p of sessionManager.getAllPendingPermissions()) {
        if (p.toolName === 'AskUserQuestionTool') {
          result.push(convertAskUserQuestionToOpencode(
            p.requestId,
            p.sessionId,
            p.input,
          ))
        }
      }

      return c.json(result)
    })
    .post('/question/:requestID/reply', async c => {
      const requestId = c.req.param('requestID')

      // 1. Try elicitation question first
      const qFound = sessionManager.findQuestionAcrossSessions(requestId)
      if (qFound) {
        const body = await c.req.json<QuestionReplyBody>()
        const content = buildElicitationContent(qFound.question.requestedSchema, body.answers)
        qFound.handle.replyQuestion(requestId, 'accept', content)
        return c.json({ resolved: true })
      }

      // 2. Try AskUserQuestionTool permission
      const pFound = sessionManager.findPermissionAcrossSessions(requestId)
      if (pFound && pFound.perm.toolName === 'AskUserQuestionTool') {
        const body = await c.req.json<QuestionReplyBody>()
        const input = pFound.perm.input as {
          questions: Array<{ question: string }>
          answers?: Record<string, string>
          annotations?: Record<string, unknown>
        }

        const answers: Record<string, string> = {}
        for (let i = 0; i < input.questions.length; i++) {
          const ansLabels = body.answers[i] ?? []
          answers[input.questions[i].question] = ansLabels.join(', ')
        }

        pFound.handle.replyPermission(requestId, 'allow', {
          updatedInput: {
            ...pFound.perm.input,
            answers,
          },
        })
        return c.json({ resolved: true })
      }

      throw notFound('question request not found')
    })
    .post('/question/:requestID/reject', async c => {
      const requestId = c.req.param('requestID')

      // 1. Try elicitation question first
      const qFound = sessionManager.findQuestionAcrossSessions(requestId)
      if (qFound) {
        qFound.handle.replyQuestion(requestId, 'decline')
        return c.json({ resolved: true })
      }

      // 2. Try AskUserQuestionTool permission
      const pFound = sessionManager.findPermissionAcrossSessions(requestId)
      if (pFound && pFound.perm.toolName === 'AskUserQuestionTool') {
        pFound.handle.replyPermission(requestId, 'deny')
        return c.json({ resolved: true })
      }

      throw notFound('question request not found')
    })
}
