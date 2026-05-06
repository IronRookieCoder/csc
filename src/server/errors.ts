import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'

export class ServeError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ServeError'
  }

  json() {
    return { error: this.code, message: this.message }
  }
}

export function badRequest(message: string): ServeError {
  return new ServeError(400, 'BAD_REQUEST', message)
}

export function unauthorized(message = 'Unauthorized'): ServeError {
  return new ServeError(401, 'UNAUTHORIZED', message)
}

export function notFound(message: string): ServeError {
  return new ServeError(404, 'NOT_FOUND', message)
}

export function conflict(message: string): ServeError {
  return new ServeError(409, 'CONFLICT', message)
}

export function tooManySessions(message: string): ServeError {
  return new ServeError(429, 'TOO_MANY_SESSIONS', message)
}

export function sessionError(message: string): ServeError {
  return new ServeError(503, 'SESSION_ERROR', message)
}

export function errorHandler(err: Error, c: Context) {
  if (err instanceof ServeError) {
    return c.json(err.json(), { status: err.status })
  }
  if (err instanceof HTTPException) {
    return c.json(
      { error: 'HTTP_ERROR', message: err.message },
      { status: err.status },
    )
  }
  const message =
    err instanceof Error && err.stack ? err.stack : err.toString()
  return c.json(
    { error: 'INTERNAL', message },
    { status: 500 },
  )
}
