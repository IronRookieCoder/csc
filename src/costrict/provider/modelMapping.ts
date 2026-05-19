/**
 * CoStrict 模型名称解析模块
 * 将 Anthropic 模型名映射到 CoStrict 模型名
 */

import { getCachedCoStrictModels, getCheapestCoStrictModel } from './models.js'

function getModelFamily(model: string): 'haiku' | 'sonnet' | 'opus' | null {
  if (/haiku/i.test(model)) return 'haiku'
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  return null
}

/**
 * 解析 CoStrict 模型名
 *
 * 优先级:
 * 1. 传入的 model 本身就是已知的 CoStrict 模型 ID（用户通过 /model 明确选择）
 * 2. COSTRICT_DEFAULT_{FAMILY}_MODEL 环境变量（按模型族）
 * 3. 直接透传原始模型名（用户手动配置的模型名）
 * 4. COSTRICT_MODEL 环境变量（仅作为最终兜底）
 */
export function resolveCoStrictModel(anthropicModel: string): string {
  const cleanModel = anthropicModel.replace(/\[1m\]$/, '')

  // 优先级 1: 如果传入的 model 本身就是已知 CoStrict 模型 ID，直接使用
  const cached = getCachedCoStrictModels()
  if (cached.some(m => m.id === cleanModel)) return cleanModel

  // 优先级 2: COSTRICT_DEFAULT_{FAMILY}_MODEL 环境变量
  const family = getModelFamily(cleanModel)
  if (family) {
    const envVar = `COSTRICT_DEFAULT_${family.toUpperCase()}_MODEL`
    const override = process.env[envVar]
    if (override) return override
    // haiku 族无 env var 时，自动选取 creditConsumption 最低的模型
    if (family === 'haiku') {
      const cheapest = getCheapestCoStrictModel()
      if (cheapest) return cheapest
    }
  }

  // 优先级 3: 直接透传原始模型名（用户手动配置的模型名优先于环境变量）
  return cleanModel
}
