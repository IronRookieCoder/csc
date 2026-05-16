import { afterEach, describe, expect, test } from 'bun:test'
import { shouldSkipPluginAutoupdate } from '../config'

describe('shouldSkipPluginAutoupdate', () => {
  const originalDisableAutoUpdater = process.env.DISABLE_AUTOUPDATER
  const originalForcePluginAutoupdate = process.env.FORCE_AUTOUPDATE_PLUGINS
  const originalEnableAutoUpdater = process.env.ENABLE_AUTOUPDATER

  afterEach(() => {
    delete process.env.DISABLE_AUTOUPDATER
    delete process.env.FORCE_AUTOUPDATE_PLUGINS
    delete process.env.ENABLE_AUTOUPDATER
    if (originalDisableAutoUpdater !== undefined) {
      process.env.DISABLE_AUTOUPDATER = originalDisableAutoUpdater
    }
    if (originalForcePluginAutoupdate !== undefined) {
      process.env.FORCE_AUTOUPDATE_PLUGINS = originalForcePluginAutoupdate
    }
    if (originalEnableAutoUpdater !== undefined) {
      process.env.ENABLE_AUTOUPDATER = originalEnableAutoUpdater
    }
  })

  test('does not skip plugin autoupdate by default', () => {
    expect(shouldSkipPluginAutoupdate()).toBe(false)
  })

  test('does not inherit the CLI auto-updater config gate', () => {
    delete process.env.ENABLE_AUTOUPDATER

    expect(shouldSkipPluginAutoupdate()).toBe(false)
  })

  test('skips plugin autoupdate when DISABLE_AUTOUPDATER is set', () => {
    process.env.DISABLE_AUTOUPDATER = '1'

    expect(shouldSkipPluginAutoupdate()).toBe(true)
  })

  test('FORCE_AUTOUPDATE_PLUGINS overrides DISABLE_AUTOUPDATER', () => {
    process.env.DISABLE_AUTOUPDATER = '1'
    process.env.FORCE_AUTOUPDATE_PLUGINS = '1'

    expect(shouldSkipPluginAutoupdate()).toBe(false)
  })
})

