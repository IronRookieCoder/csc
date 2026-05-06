import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { EventBus } from '../eventBus.js'

export function createEventRoutes(eventBus: EventBus): Hono {
  return new Hono().get('/event', async c => {
    const sessionIdFilter = c.req.query('session_id') ?? undefined
    return streamSSE(c, async stream => {
      const clientId = eventBus.addClient(stream, sessionIdFilter)
      stream.onAbort(() => {
        eventBus.removeClient(clientId)
      })

      while (true) {
        await stream.sleep(30000)
      }
    })
  })
}
