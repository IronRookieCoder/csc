import { describe, expect, test } from 'bun:test'
import { ServeError, badRequest, unauthorized, notFound, conflict, tooManySessions, sessionError } from '../errors.js'

describe('ServeError', () => {
  test('creates error with status, code, message', () => {
    const err = new ServeError(400, 'BAD_REQUEST', 'test message')
    expect(err.status).toBe(400)
    expect(err.code).toBe('BAD_REQUEST')
    expect(err.message).toBe('test message')
    expect(err.name).toBe('ServeError')
  })

  test('json() returns correct shape', () => {
    const err = new ServeError(404, 'NOT_FOUND', 'not here')
    expect(err.json()).toEqual({ error: 'NOT_FOUND', message: 'not here' })
  })
})

describe('error factories', () => {
  test('badRequest', () => {
    const err = badRequest('bad')
    expect(err.status).toBe(400)
    expect(err.code).toBe('BAD_REQUEST')
  })

  test('unauthorized', () => {
    const err = unauthorized()
    expect(err.status).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
  })

  test('notFound', () => {
    const err = notFound('missing')
    expect(err.status).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
  })

  test('conflict', () => {
    const err = conflict('dup')
    expect(err.status).toBe(409)
    expect(err.code).toBe('CONFLICT')
  })

  test('tooManySessions', () => {
    const err = tooManySessions('max')
    expect(err.status).toBe(429)
    expect(err.code).toBe('TOO_MANY_SESSIONS')
  })

  test('sessionError', () => {
    const err = sessionError('crash')
    expect(err.status).toBe(503)
    expect(err.code).toBe('SESSION_ERROR')
  })
})
