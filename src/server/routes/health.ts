import { Hono } from 'hono'
import type { SessionManager } from '../sessionManager.js'

export function createHealthRoutes(sessionManager: SessionManager): Hono {
  return new Hono().get('/health', c => {
    const uptime = process.uptime() * 1000
    return c.json({
      status: 'ok',
      version: MACRO.VERSION,
      uptime_ms: Math.round(uptime),
      active_sessions: sessionManager.getActiveCount(),
    })
  })
}
