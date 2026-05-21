import { checkNewAutoUpdate } from 'src/utils/newAutoUpdater.js'
import { useNotifications } from 'src/context/notifications.js'
import { useStartupNotification } from './useStartupNotification.js'

export function useNewAutoUpdateCheck(): void {
  const { addNotification } = useNotifications()

  useStartupNotification(async () => {
    const result = await checkNewAutoUpdate({
      onBeforeInstall: version => {
        addNotification({
          key: 'new-auto-update-installing',
          text: `Latest version v${version} released, auto-upgrading...`,
          priority: 'low' as const,
          timeoutMs: 30_000,
        })
      },
    })

    if (result.action === 'skip') return null

    if (result.action === 'notify' && result.latestVersion) {
      const typeLabel =
        result.releaseType === 'major'
          ? 'Major'
          : result.releaseType === 'minor'
            ? 'Minor'
            : 'Patch'
      return {
        key: 'new-auto-update-notification',
        text: `${typeLabel} update available: ${result.currentVersion} → ${result.latestVersion}. Run \`csc update\` to upgrade.`,
        priority: 'low' as const,
        timeoutMs: 30_000,
        color: 'warning',
        invalidates: ['new-auto-update-installing'],
      }
    }

    if (result.action === 'installed' && result.latestVersion) {
      return {
        key: 'new-auto-update-installed',
        text: `Updated to v${result.latestVersion}. Please restart to apply.`,
        priority: 'low' as const,
        timeoutMs: 30_000,
        color: 'warning',
        invalidates: ['new-auto-update-installing'],
      }
    }

    if (result.action === 'failed' && result.latestVersion) {
      return {
        key: 'new-auto-update-failed',
        text: `Auto-update to v${result.latestVersion} failed. Run \`csc update\` to upgrade manually.`,
        priority: 'medium' as const,
        timeoutMs: 30_000,
        color: 'warning',
        invalidates: ['new-auto-update-installing'],
      }
    }

    return null
  })
}