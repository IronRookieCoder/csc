import { Hono } from 'hono'
import { stat } from 'fs/promises'
import { join } from 'path'
import { badRequest } from '../errors.js'

export function createFindRoutes(): Hono {
  return new Hono().get('/find/file', async c => {
    const query = c.req.query('query')
    if (!query) throw badRequest('query is required')

    const limit = parseInt(c.req.query('limit') ?? '50', 10)
    const dirs = c.req.query('dirs') === 'true'
    const cwd = process.cwd()

    try {
      const glob = new Bun.Glob(`**/*${query}*`)
      const results: string[] = []
      for await (const path of glob.scan({ cwd, dot: false, absolute: false })) {
        if (dirs) {
          try {
            const s = await stat(join(cwd, path))
            if (!s.isDirectory()) continue
          } catch {
            continue
          }
        }
        results.push(path)
        if (results.length >= limit) break
      }

      return c.json(results)
    } catch {
      return c.json([])
    }
  })
}
