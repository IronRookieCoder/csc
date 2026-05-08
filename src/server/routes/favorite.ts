import { Hono } from 'hono'
import {
  listFavoriteItems,
  loadFavoriteItem,
  unloadFavoriteItem,
} from '../../costrict/favorite/favorite.js'
import { notFound } from '../errors.js'

export function createFavoriteRoutes(): Hono {
  return new Hono()
    .get('/global/favorite/skills', async c => {
      try {
        const items = await listFavoriteItems('skill')
        return c.json({ success: true, items })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ success: false, error: message }, 500)
      }
    })
    .post('/global/favorite/skills/:id/load', async c => {
      const id = c.req.param('id')
      try {
        const result = await loadFavoriteItem(id)
        return c.json({ success: true, item: result })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('not found')) {
          throw notFound('favorite item not found')
        }
        return c.json({ success: false, error: message }, 500)
      }
    })
    .post('/global/favorite/skills/:id/unload', async c => {
      const id = c.req.param('id')
      try {
        const result = await unloadFavoriteItem(id)
        return c.json({ success: true, item: result })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('not found')) {
          throw notFound('favorite item not found')
        }
        return c.json({ success: false, error: message }, 500)
      }
    })
}
