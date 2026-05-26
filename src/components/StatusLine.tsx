import { feature } from 'bun:bundle'
import * as React from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { useAppState } from 'src/state/AppState.js'
import { getKairosActive, getSdkBetas, getSessionId } from '../bootstrap/state.js'
import { getTotalCost, getTotalLinesAdded, getTotalLinesRemoved } from '../cost-tracker.js'
import { useSettings } from '../hooks/useSettings.js'
import { useMainLoopModel } from '../hooks/useMainLoopModel.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { calculateContextPercentages, getContextWindowForModel } from '../utils/context.js'
import { computeHitRate, tokenSignature } from '../utils/cacheStats.js'
import { getCacheStatsState, initCacheStatsState, onResponse as cacheOnResponse } from '../utils/cacheStatsState.js'
import { getRuntimeMainLoopModel, renderModelName } from '../utils/model/model.js'
import { getCurrentUsage } from '../utils/tokens.js'
import type { Message } from '../types/message.js'
import { deriveWidgetBarState } from '../utils/widgetBar.js'
import { getCurrentWorktreeSession } from '../utils/worktree.js'
import { WidgetBar } from './widget-bar/WidgetBar.js'

const CACHE_TTL_MS = 60 * 60 * 1000

type Props = {
  messagesRef: React.RefObject<Message[]>
}

export function statusLineShouldDisplay(settings: { statusLineEnabled?: boolean } | null | undefined): boolean {
  if (feature('KAIROS') && getKairosActive()) return false
  return settings?.statusLineEnabled !== false
}

function padTwo(value: number): string {
  return String(Math.floor(value)).padStart(2, '0')
}

function formatCacheCountdown(remainingMs: number | null): string {
  if (remainingMs === null) return '--:--'
  if (remainingMs <= 0) return 'exp'
  const mins = Math.floor(remainingMs / 60_000)
  const secs = Math.floor((remainingMs % 60_000) / 1000)
  return `${padTwo(mins)}:${padTwo(secs)}`
}

function StatusLineInner({ messagesRef }: Props): React.ReactNode {
  const permissionMode = useAppState(s => s.toolPermissionContext.mode)
  const settings = useSettings()
  const { columns } = useTerminalSize()
  const mainLoopModel = useMainLoopModel()
  const [now, setNow] = useState(() => Date.now())
  const previousUsageSignature = useRef<string | null>(null)

  useEffect(() => {
    void initCacheStatsState(getSessionId())
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  if (!statusLineShouldDisplay(settings)) return null

  const currentUsage = getCurrentUsage(messagesRef.current)
  if (currentUsage !== null) {
    const signature = tokenSignature(currentUsage)
    if (signature !== previousUsageSignature.current) {
      previousUsageSignature.current = signature
      cacheOnResponse(currentUsage)
    }
  }

  const builtinRuntimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel,
    exceeds200kTokens: false,
  })
  const contextWindowSize = getContextWindowForModel(builtinRuntimeModel, getSdkBetas())
  const contextUsedPct = currentUsage === null ? 0 : calculateContextPercentages(currentUsage, contextWindowSize).used ?? 0
  const cacheState = getCacheStatsState()
  const elapsed = cacheState.lastResetAt === null ? null : now - cacheState.lastResetAt
  const remainingMs = elapsed === null ? null : CACHE_TTL_MS - elapsed
  const cacheHitRate = currentUsage === null ? cacheState.lastHitRate : computeHitRate(currentUsage)
  const worktreeSession = getCurrentWorktreeSession()

  const widgetBarState = deriveWidgetBarState({
    columns,
    modelName: renderModelName(builtinRuntimeModel),
    contextUsedPct,
    totalCostUsd: getTotalCost(),
    cacheHitRate,
    cacheCountdown: formatCacheCountdown(remainingMs),
    branch: worktreeSession?.worktreeBranch,
    linesAdded: getTotalLinesAdded(),
    linesRemoved: getTotalLinesRemoved(),
  })

  return <WidgetBar state={widgetBarState} columns={columns} />
}

export const StatusLine = memo(StatusLineInner)
