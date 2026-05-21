/**
 * 新的自动升级机制 (newAutoUpdater)
 *
 * 参考 CS (opencode) 的 upgrade.ts 设计，不依赖任何原有自动升级逻辑。
 * 复用已有的 getLatestVersion / installGlobalPackage / semver 工具函数。
 *
 * 行为:
 *   - NODE_ENV=development → 跳过
 *   - DISABLE_CSC_AUTOUPDATER=1 → 跳过
 *   - 版本相同 → 跳过
 *   - patch 版本 → 自动静默安装 (npm install -g)
 *   - minor/major 版本 → 仅通知
 *   - CSC_AUTOUPDATER_NOTIFY_ONLY=1 → 所有版本仅通知
 */

import { type ReleaseChannel, getGlobalConfig } from './config.js'
import { getLatestVersion, installGlobalPackage } from './autoUpdater.js'
import { getInitialSettings } from './settings/settings.js'
import { gt } from './semver.js'
import { logForDebugging } from './debug.js'

export type NewAutoUpdateAction = 'skip' | 'notify' | 'installed' | 'failed'

export type NewAutoUpdateResult = {
  action: NewAutoUpdateAction
  currentVersion: string
  latestVersion: string | null
  releaseType?: 'patch' | 'minor' | 'major'
  errorMessage?: string
}

export function isNewAutoUpdaterDisabled(): boolean {
  if (process.env.NODE_ENV === 'development') return true
  if (
    process.env.DISABLE_CSC_AUTOUPDATER === '1' ||
    process.env.DISABLE_CSC_AUTOUPDATER === 'true'
  ) {
    return true
  }
  return false
}

export function isNewAutoUpdateNotifyOnly(): boolean {
  return (
    process.env.CSC_AUTOUPDATER_NOTIFY_ONLY === '1' ||
    process.env.CSC_AUTOUPDATER_NOTIFY_ONLY === 'true'
  )
}

function parseSemverParts(version: string): {
  major: number
  minor: number
} {
  const parts = version.split('.')
  return {
    major: Number.parseInt(parts[0] ?? '0', 10),
    minor: Number.parseInt(parts[1] ?? '0', 10),
  }
}

function getReleaseType(
  current: string,
  latest: string,
): 'patch' | 'minor' | 'major' {
  const curr = parseSemverParts(current)
  const next = parseSemverParts(latest)

  if (next.major > curr.major) return 'major'
  if (next.minor > curr.minor) return 'minor'
  return 'patch'
}

export type NewAutoUpdateCallbacks = {
  onBeforeInstall?: (version: string) => void
}

export async function checkNewAutoUpdate(
  callbacks?: NewAutoUpdateCallbacks,
): Promise<NewAutoUpdateResult> {
  const currentVersion = MACRO.VERSION
  logForDebugging(`[newAutoUpdater] checking, current: ${currentVersion}`)

  if (isNewAutoUpdaterDisabled()) {
    return { action: 'skip', currentVersion, latestVersion: null }
  }

  // 获取 autoUpdatesChannel 配置，默认 'latest'
  let channel: ReleaseChannel = 'latest'
  try {
    const settings = getInitialSettings()
    if (settings.autoUpdatesChannel === 'stable') {
      channel = 'stable'
    }
  } catch {
    // settings 读取失败使用默认值
  }

  const latestVersion = await getLatestVersion(channel)
  logForDebugging(`[newAutoUpdater] latest: ${JSON.stringify(latestVersion)}`)

  if (!latestVersion) {
    return { action: 'skip', currentVersion, latestVersion: null }
  }

  if (!gt(latestVersion, currentVersion)) {
    logForDebugging(`[newAutoUpdater] up to date (${currentVersion} >= ${latestVersion})`)
    return { action: 'skip', currentVersion, latestVersion }
  }

  const releaseType = getReleaseType(currentVersion, latestVersion)
  const notifyOnly = isNewAutoUpdateNotifyOnly()
  logForDebugging(`[newAutoUpdater] type: ${releaseType}, notifyOnly: ${notifyOnly}`)

  // minor/major 或 notifyOnly 模式 → 仅通知
  if (releaseType !== 'patch' || notifyOnly) {
    return { action: 'notify', currentVersion, latestVersion, releaseType }
  }

  // patch → 尝试自动安装 (仅 npm-global)
  const config = getGlobalConfig()
  if (config.installMethod !== 'global') {
    logForDebugging(`[newAutoUpdater] skip install, method: ${config.installMethod}`)
    return { action: 'notify', currentVersion, latestVersion, releaseType }
  }

  callbacks?.onBeforeInstall?.(latestVersion)
  const result = await installGlobalPackage(latestVersion)
  if (result.status === 'success') {
    logForDebugging('[newAutoUpdater] installed successfully')
    return {
      action: 'installed',
      currentVersion,
      latestVersion,
      releaseType,
    }
  }

  logForDebugging(
    `[newAutoUpdater] install FAILED — category: ${result.errorCategory ?? 'unknown'}, suggestion: ${result.suggestion ?? 'none'}, stderr: ${result.npmStderr ?? 'none'}`,
    { level: 'error' },
  )
  return {
    action: 'failed',
    currentVersion,
    latestVersion,
    releaseType,
    errorMessage: result.suggestion ?? result.errorCategory ?? 'Install failed',
  }
}
