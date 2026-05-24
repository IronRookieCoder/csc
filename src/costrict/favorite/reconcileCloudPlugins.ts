import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createCoStrictFetch } from '../provider/fetch.js'
import { getCoStrictBaseURL } from '../provider/auth.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { installPluginOp } from '../../services/plugins/pluginOperations.js'
import { addMarketplaceSource } from '../../utils/plugins/marketplaceManager.js'
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js'
import { parseMarketplaceInput } from '../../utils/plugins/parseMarketplaceInput.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'

/**
 * Cloud plugin reconciliation.
 *
 * This is the plugin sibling of `autoEnableCloudFavorites()` (skills/agents/
 * commands/mcps). It is deliberately DECOUPLED from the `/hub` favorite state
 * machine (favorite.ts / state.json): web-favorited plugins surface ONLY in the
 * native `/plugin -> Installed` panel, never in `/hub`. It converges the native
 * plugin state by importing csc's own plugin ops (addMarketplaceSource +
 * installPluginOp) rather than spawning `csc plugin` subprocesses.
 *
 * Lifecycle mirrors the skill chain exactly:
 *  - first-time favorite: ensure marketplace, then install (auto-enables)
 *  - respect user disable: a plugin we enabled but the user later disabled in
 *    `/plugin` is re-marked `unloaded` and never re-enabled
 *  - unfavorite is a no-op: plugins dropped from the remote set are neither
 *    disabled nor uninstalled
 *  - manual installs are never touched: a plugin present on disk but absent
 *    from our ledger is left entirely alone
 *
 * A provenance ledger at ~/.claude/favorites/plugins.json records the
 * cloud-managed `<plugin>@<marketplace>` keys and their lifecycle, mirroring the
 * skill state.json. Reconcile only ever acts within the ledger's keys.
 */

const PLUGIN_PAGE_SIZE = 20
const PLUGIN_MAX_PAGES = 20
const FETCH_TIMEOUT_MS = 15000

type LedgerLifecycle = 'active' | 'unloaded' | 'install_failed'

type LedgerRecord = {
  key: string
  pluginName: string
  marketplaceName: string
  marketplaceRepo: string
  lifecycle: LedgerLifecycle
  installedAt: string
  updatedAt: string
  lastError?: string
}

type PluginLedger = {
  plugins: Record<string, LedgerRecord>
}

type DesiredPlugin = {
  id: string
  pluginName: string
  marketplaceName: string
  marketplaceRepo: string
}

function pluginLedgerPath() {
  return path.join(getClaudeConfigHomeDir(), 'favorites', 'plugins.json')
}

async function readLedger(): Promise<PluginLedger> {
  try {
    const text = await readFile(pluginLedgerPath(), 'utf-8')
    const parsed = JSON.parse(text) as Partial<PluginLedger>
    return { plugins: parsed.plugins ?? {} }
  } catch {
    return { plugins: {} }
  }
}

async function writeLedger(ledger: PluginLedger) {
  const dir = path.dirname(pluginLedgerPath())
  await mkdir(dir, { recursive: true })
  await writeFile(pluginLedgerPath(), JSON.stringify(ledger, null, 2) + '\n')
}

function now() {
  return new Date().toISOString()
}

function makeRecord(
  plugin: DesiredPlugin,
  key: string,
  lifecycle: LedgerLifecycle,
  prev: LedgerRecord | undefined,
  lastError?: string,
): LedgerRecord {
  return {
    key,
    pluginName: plugin.pluginName,
    marketplaceName: plugin.marketplaceName,
    marketplaceRepo: plugin.marketplaceRepo,
    lifecycle,
    installedAt: prev?.installedAt ?? now(),
    updatedAt: now(),
    ...(lastError ? { lastError } : {}),
  }
}

async function fetchWithTimeout(
  costrictFetch: ReturnType<typeof createCoStrictFetch>,
  url: string,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await costrictFetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Pull the install envelope (plugin_name / marketplace_name / marketplace_repo)
 * out of an item's `metadata`. The server stores the install object as canonical
 * JSON; depending on the endpoint it may arrive as a JSON string or an object,
 * and may be wrapped in an `install` key or be the install object itself.
 */
function extractInstall(
  data: Record<string, unknown>,
): Omit<DesiredPlugin, 'id'> | undefined {
  let meta: unknown = data.metadata
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta)
    } catch {
      meta = undefined
    }
  }
  if (!meta || typeof meta !== 'object') return undefined
  const metaObj = meta as Record<string, unknown>
  const install = (
    metaObj.install && typeof metaObj.install === 'object'
      ? metaObj.install
      : metaObj
  ) as Record<string, unknown>

  const pluginName = String(install.plugin_name ?? install.pluginName ?? '')
  const marketplaceName = String(
    install.marketplace_name ?? install.marketplaceName ?? '',
  )
  const marketplaceRepo = String(
    install.marketplace_repo ?? install.marketplaceRepo ?? '',
  )
  if (!pluginName || !marketplaceName || !marketplaceRepo) return undefined
  return { pluginName, marketplaceName, marketplaceRepo }
}

async function getRemoteItemRaw(
  baseUrl: string,
  costrictFetch: ReturnType<typeof createCoStrictFetch>,
  id: string,
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(
    costrictFetch,
    `${baseUrl}/cloud-api/api/items/${id}`,
  )
  if (!response.ok) {
    throw new Error(`plugin detail request failed: ${response.status}`)
  }
  return (await response.json()) as Record<string, unknown>
}

/**
 * Fetch the desired set of favorited plugins from the server, reading each
 * item's install metadata (falling back to a per-item detail fetch when the
 * list response omits metadata).
 */
async function listFavoritedPlugins(): Promise<DesiredPlugin[]> {
  const baseUrl = getCoStrictBaseURL()
  const costrictFetch = createCoStrictFetch()
  const out: DesiredPlugin[] = []
  const seen = new Set<string>()

  for (let page = 1; page <= PLUGIN_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PLUGIN_PAGE_SIZE),
      type: 'plugin',
      favorited: 'true',
    })
    const url = `${baseUrl}/cloud-api/api/items?${params.toString()}`
    const response = await fetchWithTimeout(costrictFetch, url)
    if (!response.ok) {
      throw new Error(`plugin list request failed: ${response.status}`)
    }
    const data = (await response.json()) as {
      items?: Array<Record<string, unknown>>
      hasMore?: boolean
    }
    const items = data.items ?? []

    for (const item of items) {
      const id = String(item.id ?? '')
      if (!id || seen.has(id)) continue
      if (String(item.itemType ?? 'plugin') !== 'plugin') continue
      // Honour an explicit favorited=false (list is already filtered, but the
      // field may echo back per-item).
      if (item.favorited === false || item.favorited === 'false') continue

      let install = extractInstall(item)
      if (!install) {
        const detail = await getRemoteItemRaw(baseUrl, costrictFetch, id).catch(
          () => undefined,
        )
        if (detail) install = extractInstall(detail)
      }
      if (!install) {
        logForDebugging(
          `[plugin-reconcile] skipping ${id}: missing install metadata`,
        )
        continue
      }
      seen.add(id)
      out.push({ id, ...install })
    }

    if (!data.hasMore || items.length === 0) break
  }

  return out
}

function enabledPluginsSnapshot(): Record<string, unknown> {
  const settings = getSettingsForSource('userSettings')
  return (settings?.enabledPlugins ?? {}) as Record<string, unknown>
}

function isEnabled(value: unknown): boolean {
  return value === true || (Array.isArray(value) && value.length > 0)
}

/**
 * Materialize a marketplace by `owner/repo`. Idempotent: addMarketplaceSource
 * skips the clone when the source is already materialized. Throws on policy /
 * network / invalid-source failures (caught per-plugin by the caller).
 */
async function ensureMarketplace(repo: string): Promise<void> {
  const source = await parseMarketplaceInput(repo)
  if (!source || 'error' in source) {
    const reason =
      source && 'error' in source ? source.error : 'unrecognized source'
    throw new Error(`invalid marketplace repo "${repo}": ${reason}`)
  }
  await addMarketplaceSource(source)
}

export async function reconcileCloudPlugins(): Promise<void> {
  try {
    const desired = await listFavoritedPlugins()
    if (desired.length === 0) return

    const ledger = await readLedger()
    // Snapshots taken once up front: they reflect the on-disk / settings state
    // at startup, which is exactly what we compare against to detect a user's
    // prior manual disable.
    const installed = loadInstalledPluginsV2()
    const enabled = enabledPluginsSnapshot()

    let mutated = false

    for (const plugin of desired) {
      const key = `${plugin.pluginName}@${plugin.marketplaceName}`
      const prev = ledger.plugins[key]
      try {
        const installedHere = Boolean(installed.plugins[key])

        // ── Case A: not installed → first-time favorite ──
        if (!installedHere) {
          await ensureMarketplace(plugin.marketplaceRepo)
          const result = await installPluginOp(key, 'user')
          if (!result.success) {
            ledger.plugins[key] = makeRecord(
              plugin,
              key,
              'install_failed',
              prev,
              result.message,
            )
            mutated = true
            logForDebugging(
              `[plugin-reconcile] install failed ${key}: ${result.message}`,
            )
            continue
          }
          ledger.plugins[key] = makeRecord(plugin, key, 'active', prev)
          mutated = true
          continue
        }

        // ── Case B: already installed ──

        // Installed but never tracked by us → user's own `/plugin install`.
        // Never enable/disable/uninstall a manual install.
        if (!prev) {
          logForDebugging(
            `[plugin-reconcile] ${key} installed outside ledger, leaving manual install untouched`,
          )
          continue
        }

        // User explicitly unloaded it before → respect across restarts.
        if (prev.lifecycle === 'unloaded') continue

        if (!isEnabled(enabled[key])) {
          if (prev.lifecycle === 'active') {
            // We enabled it before but it is now disabled → the user turned it
            // off in `/plugin`. Respect that and stop managing its enabled state.
            ledger.plugins[key] = makeRecord(plugin, key, 'unloaded', prev)
            mutated = true
            continue
          }
          // Retry a previously failed install/enable.
          await ensureMarketplace(plugin.marketplaceRepo)
          const result = await installPluginOp(key, 'user')
          ledger.plugins[key] = result.success
            ? makeRecord(plugin, key, 'active', prev)
            : makeRecord(plugin, key, 'install_failed', prev, result.message)
          mutated = true
        }

        // Installed + enabled + ledger active → already converged.
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ledger.plugins[key] = makeRecord(
          plugin,
          key,
          'install_failed',
          prev,
          message,
        )
        mutated = true
        logForDebugging(`[plugin-reconcile] error reconciling ${key}: ${message}`)
      }
    }

    if (mutated) await writeLedger(ledger)
  } catch {
    // Never let a flaky cloud API or plugin op break startup.
  }
}
