import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Server as BunServer } from 'bun'
import { EventBus } from './eventBus.js'
import { SessionManager } from './sessionManager.js'
import { errorHandler } from './errors.js'
import { createHealthRoutes } from './routes/health.js'
import { createInfoRoutes } from './routes/info.js'
import { createSessionRoutes } from './routes/session.js'
import { createEventRoutes } from './routes/event.js'
import { createPermissionRoutes } from './routes/permission.js'
import { createQuestionRoutes } from './routes/question.js'
import { createMessageRoutes } from './routes/message.js'
import { createProviderRoutes } from './routes/provider.js'
import { createFindRoutes } from './routes/find.js'
import type { ServerConfig } from './types.js'

export function startServer(
  config: ServerConfig,
  sessionManager: SessionManager,
): BunServer & { port?: number } {
  const eventBus = new EventBus()
  eventBus.startHeartbeat()

  const app = new Hono()

  app.onError(errorHandler)

  // Auth is intentionally disabled for now so multiple local serve instances
  // can be started and consumed without token plumbing.

  app.use(
    '*',
    cors({
      maxAge: 86400,
      origin: (input) => {
        if (!input) return
        if (input.startsWith('http://localhost:')) return input
        if (input.startsWith('http://127.0.0.1:')) return input
        return
      },
    }),
  )

  app.route('/', createHealthRoutes(sessionManager))
  app.route('/', createInfoRoutes(sessionManager))
  app.route('/', createSessionRoutes(sessionManager))
  app.route('/', createEventRoutes(eventBus))
  app.route('/', createPermissionRoutes(sessionManager))
  app.route('/', createQuestionRoutes(sessionManager))
  app.route('/', createMessageRoutes(sessionManager))
  app.route('/', createProviderRoutes(sessionManager))
  app.route('/', createFindRoutes())

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: app.fetch,
  })

  return server
}
