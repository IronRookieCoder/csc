import { Hono } from 'hono'
import type { SessionManager } from '../sessionManager.js'
import type { InitData } from '../sessionHandle.js'

export function createProviderRoutes(sessionManager: SessionManager): Hono {
  return new Hono()
    .get('/provider', c => {
      const initData = getFirstInitData(sessionManager)
      const models = initData?.models ?? {}
      const modelValues = Object.values(models as Record<string, string>)
      const defaultModel = modelValues[0] ?? ''

      return c.json({
        connected: initData?.account?.apiProvider
          ? [initData.account.apiProvider]
          : ['anthropic'],
        default_model: defaultModel,
        providers: [
          {
            id: initData?.account?.apiProvider ?? 'anthropic',
            name:
              initData?.account?.apiProvider === 'firstParty'
                ? 'Anthropic'
                : initData?.account?.apiProvider ?? 'Anthropic',
            connected: true,
            models: Object.entries(models as Record<string, string>).map(
              ([key, id]) => ({
                id,
                name: key,
              }),
            ),
          },
        ],
      })
    })
    .get('/provider/capabilities', c => {
      const initData = getFirstInitData(sessionManager)
      const models = initData?.models ?? {}

      return c.json({
        connected: [
          {
            provider_id: initData?.account?.apiProvider ?? 'anthropic',
            provider_name:
              initData?.account?.apiProvider === 'firstParty'
                ? 'Anthropic'
                : initData?.account?.apiProvider ?? 'Anthropic',
            models: Object.entries(models as Record<string, string>).map(
              ([key, id]) => ({
                model_id: id,
                model_name: key,
              }),
            ),
          },
        ],
      })
    })
}

function getFirstInitData(sessionManager: SessionManager): InitData | null {
  for (const handle of sessionManager.getAllSessions()) {
    if (handle.initData) return handle.initData
  }
  return null
}
