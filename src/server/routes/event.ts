import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { EventBus } from '../eventBus.js'
import { canonicalizePath } from '../../utils/sessionStoragePortable.js'

export function createEventRoutes(eventBus: EventBus): Hono {
  return new Hono()
    .get('/event', async c => {
      const sessionIdFilter = c.req.query('session_id') ?? undefined
      const headerDir = c.req.header('x-csc-directory')
      const cwdFilter = headerDir ? await canonicalizePath(decodeURIComponent(headerDir)) : undefined
      return streamSSE(c, async stream => {
        const clientId = eventBus.addClient(stream, sessionIdFilter, cwdFilter)
        stream.onAbort(() => {
          eventBus.removeClient(clientId)
        })

        while (true) {
          await stream.sleep(30000)
        }
      })
    })
    .get('/global/event', async c => {
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
