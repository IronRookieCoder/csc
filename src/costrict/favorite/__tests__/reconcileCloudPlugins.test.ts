import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ── Mutable test state that the module mocks delegate to ──────────────────────
let tempHome = ''
let listItems: Array<Record<string, unknown>> = []
let detailById: Record<string, Record<string, unknown>> = {}
let installedPlugins: Record<string, unknown[]> = {}
let enabledPlugins: Record<string, unknown> = {}
let installResult: { success: boolean; message: string } = {
  success: true,
  message: 'ok',
}
const marketplaceCalls: string[] = []
const installCalls: string[] = []
const uninstallCalls: string[] = []

function installEnvelope(
  pluginName: string,
  marketplaceName: string,
  marketplaceRepo: string,
) {
  return {
    install: {
      method: 'plugin_marketplace',
      plugin_name: pluginName,
      marketplace_name: marketplaceName,
      marketplace_repo: marketplaceRepo,
    },
  }
}

function makeItem(
  id: string,
  pluginName: string,
  marketplaceName: string,
  marketplaceRepo: string,
): Record<string, unknown> {
  return {
    id,
    slug: pluginName,
    name: pluginName,
    itemType: 'plugin',
    favorited: true,
    metadata: installEnvelope(pluginName, marketplaceName, marketplaceRepo),
  }
}

// ── Module mocks (registered before importing the module under test).
// Specifiers are resolved relative to THIS test file, so they must land on the
// same absolute paths that reconcileCloudPlugins.ts imports.
mock.module('../../../utils/envUtils.js', () => ({
  getClaudeConfigHomeDir: () => tempHome,
}))
mock.module('../../../utils/debug.js', () => ({
  logForDebugging: () => {},
}))
mock.module('../../provider/auth.js', () => ({
  getCoStrictBaseURL: () => 'http://test.local',
}))
mock.module('../../provider/fetch.js', () => ({
  createCoStrictFetch: () => async (url: string | URL) => {
    const u = String(url)
    if (u.includes('/api/items?')) {
      return new Response(JSON.stringify({ items: listItems, hasMore: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const id = u.split('/api/items/')[1] ?? ''
    const detail = detailById[id]
    return new Response(JSON.stringify(detail ?? {}), {
      status: detail ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    })
  },
}))
mock.module('../../../services/plugins/pluginOperations.js', () => ({
  installPluginOp: async (plugin: string) => {
    installCalls.push(plugin)
    return installResult
  },
  uninstallPluginOp: async (plugin: string) => {
    uninstallCalls.push(plugin)
    return { success: true, message: 'uninstalled' }
  },
}))
mock.module('../../../utils/plugins/marketplaceManager.js', () => ({
  addMarketplaceSource: async (source: { repo?: string }) => {
    marketplaceCalls.push(source.repo ?? JSON.stringify(source))
    return { name: 'mkt', alreadyMaterialized: false, resolvedSource: source }
  },
}))
mock.module('../../../utils/plugins/installedPluginsManager.js', () => ({
  loadInstalledPluginsV2: () => ({ version: 2, plugins: installedPlugins }),
}))
mock.module('../../../utils/plugins/parseMarketplaceInput.js', () => ({
  parseMarketplaceInput: async (repo: string) => ({ source: 'github', repo }),
}))
mock.module('../../../utils/settings/settings.js', () => ({
  getSettingsForSource: () => ({ enabledPlugins }),
}))

const { reconcileCloudPlugins } = await import('../reconcileCloudPlugins.js')

function ledgerPath() {
  return path.join(tempHome, 'favorites', 'plugins.json')
}

function readLedger(): { plugins: Record<string, any> } {
  if (!existsSync(ledgerPath())) return { plugins: {} }
  return JSON.parse(readFileSync(ledgerPath(), 'utf-8'))
}

function seedLedger(plugins: Record<string, unknown>) {
  mkdirSync(path.join(tempHome, 'favorites'), { recursive: true })
  writeFileSync(ledgerPath(), JSON.stringify({ plugins }, null, 2))
}

const AGG = 'https://github.com/costrict-plugins-repo/marketplace.git'

describe('reconcileCloudPlugins', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), 'csc-plugin-reconcile-'))
    listItems = []
    detailById = {}
    installedPlugins = {}
    enabledPlugins = {}
    installResult = { success: true, message: 'ok' }
    marketplaceCalls.length = 0
    installCalls.length = 0
    uninstallCalls.length = 0
  })

  afterEach(() => {
    // temp dirs live under the OS temp dir; cheap and auto-reaped by the OS
  })

  test('first-time favorite: adds aggregated marketplace, installs @costrict-plugins, records active', async () => {
    listItems = [
      makeItem('1', 'claude-api', 'anthropic-agent-skills', 'anthropics/skills'),
    ]

    await reconcileCloudPlugins()

    // installs from the aggregated costrict-plugins marketplace, NOT the origin repo
    expect(marketplaceCalls).toEqual([AGG])
    expect(installCalls).toEqual(['claude-api@costrict-plugins'])
    const rec = readLedger().plugins['claude-api@costrict-plugins']
    expect(rec.lifecycle).toBe('active')
    expect(rec.marketplaceName).toBe('costrict-plugins')
    expect(rec.originRepo).toBe('anthropics/skills')
  })

  test('aggregated marketplace is added once for multiple favorites', async () => {
    listItems = [
      makeItem('1', 'claude-api', 'anthropic-agent-skills', 'anthropics/skills'),
      makeItem('2', 'frontend-slides', 'frontend-slides', 'zarazhangrui/frontend-slides'),
    ]

    await reconcileCloudPlugins()

    expect(marketplaceCalls).toEqual([AGG]) // exactly once, not per-plugin
    expect(installCalls.sort()).toEqual(
      ['claude-api@costrict-plugins', 'frontend-slides@costrict-plugins'].sort(),
    )
  })

  test('falls back to detail fetch when the list omits install metadata', async () => {
    // List response carries no metadata; the per-item detail endpoint does.
    listItems = [{ id: '9', itemType: 'plugin', favorited: true }]
    detailById = {
      '9': {
        id: '9',
        itemType: 'plugin',
        metadata: installEnvelope('foo', 'mkt-name', 'owner/repo'),
      },
    }

    await reconcileCloudPlugins()

    expect(installCalls).toEqual(['foo@costrict-plugins'])
  })

  test('respects user disable: ledger active but now disabled becomes unloaded', async () => {
    const key = 'claude-api@costrict-plugins'
    listItems = [
      makeItem('1', 'claude-api', 'anthropic-agent-skills', 'anthropics/skills'),
    ]
    installedPlugins = { [key]: [{ scope: 'user' }] }
    enabledPlugins = { [key]: false }
    seedLedger({
      [key]: {
        key,
        pluginName: 'claude-api',
        marketplaceName: 'costrict-plugins',
        originRepo: 'anthropics/skills',
        lifecycle: 'active',
        installedAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    })

    await reconcileCloudPlugins()

    expect(installCalls).toEqual([]) // never re-enabled
    expect(readLedger().plugins[key].lifecycle).toBe('unloaded')
  })

  test('respects prior unloaded: stays unloaded, no install', async () => {
    const key = 'p@costrict-plugins'
    listItems = [makeItem('1', 'p', 'm', 'o/r')]
    installedPlugins = { [key]: [{ scope: 'user' }] }
    enabledPlugins = { [key]: false }
    seedLedger({
      [key]: {
        key,
        pluginName: 'p',
        marketplaceName: 'costrict-plugins',
        originRepo: 'o/r',
        lifecycle: 'unloaded',
        installedAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    })

    await reconcileCloudPlugins()

    expect(installCalls).toEqual([])
    expect(readLedger().plugins[key].lifecycle).toBe('unloaded')
  })

  test("never touches a user's manual install (installed but absent from ledger)", async () => {
    const key = 'manual@costrict-plugins'
    listItems = [makeItem('1', 'manual', 'm', 'o/r')]
    installedPlugins = { [key]: [{ scope: 'user' }] }
    enabledPlugins = { [key]: false }
    // no ledger seed → key absent from ledger

    await reconcileCloudPlugins()

    expect(installCalls).toEqual([]) // manual install never enabled/installed
    expect(readLedger().plugins[key]).toBeUndefined()
  })

  test('install failure is recorded as install_failed and does not throw', async () => {
    listItems = [makeItem('1', 'p', 'm', 'o/r')]
    installResult = { success: false, message: 'SSH dependency missing' }

    await reconcileCloudPlugins()

    const rec = readLedger().plugins['p@costrict-plugins']
    expect(rec.lifecycle).toBe('install_failed')
    expect(rec.lastError).toBe('SSH dependency missing')
  })

  test('unfavorite uninstalls the plugin and drops it from the ledger', async () => {
    const key = 'gone@costrict-plugins'
    listItems = [] // nothing favorited remotely anymore
    installedPlugins = { [key]: [{ scope: 'user' }] }
    enabledPlugins = { [key]: true }
    seedLedger({
      [key]: {
        key,
        pluginName: 'gone',
        marketplaceName: 'costrict-plugins',
        originRepo: 'o/r',
        lifecycle: 'active',
        installedAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    })

    await reconcileCloudPlugins()

    expect(uninstallCalls).toEqual([key]) // uninstalled so it disappears
    expect(installCalls).toEqual([])
    expect(readLedger().plugins[key]).toBeUndefined() // dropped from ledger
  })

  test('unfavorite one of several: only the dropped one is uninstalled', async () => {
    const kept = 'kept@costrict-plugins'
    const dropped = 'dropped@costrict-plugins'
    listItems = [makeItem('1', 'kept', 'm', 'o/r')] // only "kept" still favorited
    installedPlugins = {
      [kept]: [{ scope: 'user' }],
      [dropped]: [{ scope: 'user' }],
    }
    enabledPlugins = { [kept]: true, [dropped]: true }
    seedLedger({
      [kept]: {
        key: kept,
        pluginName: 'kept',
        marketplaceName: 'costrict-plugins',
        originRepo: 'o/r',
        lifecycle: 'active',
        installedAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      [dropped]: {
        key: dropped,
        pluginName: 'dropped',
        marketplaceName: 'costrict-plugins',
        originRepo: 'o/r',
        lifecycle: 'active',
        installedAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    })

    await reconcileCloudPlugins()

    expect(uninstallCalls).toEqual([dropped])
    expect(installCalls).toEqual([]) // "kept" already installed+enabled+active
    const ledger = readLedger().plugins
    expect(ledger[dropped]).toBeUndefined()
    expect(ledger[kept].lifecycle).toBe('active')
  })
})
