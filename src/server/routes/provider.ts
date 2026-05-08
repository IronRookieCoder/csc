import { Hono } from 'hono'
import type { SessionManager } from '../sessionManager.js'
import type { InitData } from '../sessionHandle.js'

type ModelInfo = {
  value: string
  displayName: string
  description: string
  supportsEffort?: boolean
  supportedEffortLevels?: string[]
  supportsAdaptiveThinking?: boolean
  supportsFastMode?: boolean
  supportsAutoMode?: boolean
}

function getModels(initData: InitData | null): ModelInfo[] {
  const raw = initData?.models
  if (Array.isArray(raw)) return raw as ModelInfo[]
  return []
}

function getProviderId(initData: InitData | null): string {
  const p = initData?.account?.apiProvider
  if (!p || p === 'firstParty') return 'anthropic'
  return p
}

function getProviderName(initData: InitData | null): string {
  const p = initData?.account?.apiProvider
  if (p === 'firstParty') return 'Anthropic'
  if (p === 'costrict') return 'CoStrict'
  return p ?? 'Anthropic'
}

function toCapabilities(initData: InitData | null) {
  const models = getModels(initData)
  const providerId = getProviderId(initData)
  const providerName = getProviderName(initData)
  const defaultModel = models[0]?.value ?? ''

  const modelsRecord: Record<string, unknown> = {}
  for (const m of models) {
    modelsRecord[m.value] = {
      id: m.value,
      name: m.displayName,
      limit: {
        context: 200000,
        output: 8192,
      },
      capabilities: {
        temperature: false,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      status: 'active' as const,
    }
  }

  return {
    connected: [{
      id: providerId,
      name: providerName,
      source: 'config' as const,
      default_model: defaultModel,
      models: modelsRecord,
    }],
  }
}

export function createProviderRoutes(sessionManager: SessionManager): Hono {
  return new Hono()
    .get('/provider', async c => {
      let initData = sessionManager.getCachedInitData()
      if (!initData) {
        await sessionManager.waitForInitData()
        initData = sessionManager.getCachedInitData()
      }

      return c.json(toCapabilities(initData))
    })
    .get('/provider/capabilities', async c => {
      let initData = sessionManager.getCachedInitData()
      if (!initData) {
        await sessionManager.waitForInitData()
        initData = sessionManager.getCachedInitData()
      }

      return c.json(toCapabilities(initData))
    })
}
