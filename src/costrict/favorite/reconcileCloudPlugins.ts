import path from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createCoStrictFetch } from '../provider/fetch.js'
import { getCoStrictBaseURL } from '../provider/auth.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  installPluginOp,
  uninstallPluginOp,
} from '../../services/plugins/pluginOperations.js'
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
 * Lifecycle:
 *  - first-time favorite: ensure the aggregated marketplace, then install
 *    (auto-enables)
 *  - respect user disable: a plugin we enabled but the user later disabled in
 *    `/plugin` is re-marked `unloaded` and never re-enabled
 *  - unfavorite → uninstall: a ledger-tracked plugin that is no longer in the
 *    remote favorited set is uninstalled so it disappears from `/plugin →
 *    Installed`, then dropped from the ledger (this intentionally goes further
 *    than the skill chain, which leaves remotely-unfavorited skills in place)
 *  - manual installs are never touched: a plugin present on disk but absent
 *    from our ledger is left entirely alone
 *
 * Runs in-process (async I/O on the event loop — no child process); plugin ops
 * spawn git via execa (non-detached, auto-killed on csc exit), so a mid-flight
 * reconcile leaves no orphaned subprocess.
 *
 * A provenance ledger at ~/.claude/favorites/plugins.json records the
 * cloud-managed `<plugin>@<marketplace>` keys and their lifecycle, mirroring the
 * skill state.json. Reconcile only ever acts within the ledger's keys.
 */

const PLUGIN_PAGE_SIZE = 20
const PLUGIN_MAX_PAGES = 20
const FETCH_TIMEOUT_MS = 15000

// All cloud-favorited plugins install from the single aggregated
// "costrict-plugins" marketplace (mirrors the ~700 verified plugins behind one
// endpoint, for both public-internet and air-gapped/internal-git users) — NOT
// from each plugin's original upstream marketplace_repo. This matches the
// `<plugin>@costrict-plugins` install commands the web renders. Air-gapped /
// internal mirrors override the source via COSTRICT_PLUGIN_MARKETPLACE_URL.
const AGGREGATED_MARKETPLACE_NAME = 'costrict-plugins'
const AGGREGATED_MARKETPLACE_SOURCE =
  process.env.COSTRICT_PLUGIN_MARKETPLACE_URL ??
  'https://github.com/costrict-plugins-repo/marketplace.git'

type LedgerLifecycle = 'active' | 'unloaded' | 'install_failed'

type LedgerRecord = {
  key: string
  pluginName: string
  marketplaceName: string
  originRepo: string
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
  const target = pluginLedgerPath()
  await mkdir(path.dirname(target), { recursive: true })
  // Atomic: write a temp file then rename, so a crash mid-write can never leave
  // a truncated plugins.json (a corrupt ledger would parse-fail → reset to empty
  // → orphan every cloud-managed plugin).
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(ledger, null, 2) + '\n')
  await rename(tmp, target)
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
    marketplaceName: AGGREGATED_MARKETPLACE_NAME,
    originRepo: plugin.marketplaceRepo,
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
 * Materialize the single aggregated `costrict-plugins` marketplace. All plugins
 * install from here, so this is called once per reconcile (before the loop).
 * Idempotent: addMarketplaceSource skips the clone when already materialized.
 * Throws on policy / network / invalid-source failures.
 */
async function ensureAggregatedMarketplace(): Promise<void> {
  const source = await parseMarketplaceInput(AGGREGATED_MARKETPLACE_SOURCE)
  if (!source || 'error' in source) {
    const reason =
      source && 'error' in source ? source.error : 'unrecognized source'
    throw new Error(
      `invalid costrict-plugins marketplace source "${AGGREGATED_MARKETPLACE_SOURCE}": ${reason}`,
    )
  }
  await addMarketplaceSource(source)
}

export async function reconcileCloudPlugins(): Promise<void> {
  try {
    // Dedupe by ledger key: distinct catalog items can carry the same
    // plugin_name (different origin repos) yet all map to a single
    // `<pluginName>@costrict-plugins` install — install/track it once.
    const desiredByKey = new Map<string, DesiredPlugin>()
    for (const p of await listFavoritedPlugins()) {
      desiredByKey.set(`${p.pluginName}@${AGGREGATED_MARKETPLACE_NAME}`, p)
    }
    const desired = [...desiredByKey.values()]
    const desiredKeys = new Set(desiredByKey.keys())

    const ledger = await readLedger()
    // On-disk install snapshot (memoized). Removal and install passes act on
    // disjoint key sets, so reusing this single snapshot is safe.
    const installed = loadInstalledPluginsV2()

    let mutated = false

    // ── Removal pass: a ledger-tracked plugin that is no longer favorited gets
    //    uninstalled (so it disappears from `/plugin → Installed`) and dropped
    //    from the ledger. Manual installs are never in the ledger → untouched.
    for (const key of Object.keys(ledger.plugins)) {
      if (desiredKeys.has(key)) continue
      try {
        const result = await uninstallPluginOp(key, 'user')
        if (result.success || !installed.plugins[key]) {
          // Uninstalled, or it was not installed at our scope to begin with →
          // stop tracking it.
          delete ledger.plugins[key]
          mutated = true
          logForDebugging(`[plugin-reconcile] unfavorited ${key} → removed`)
        } else {
          // Still installed but the uninstall did not take (e.g. another scope);
          // keep the ledger entry and retry next startup rather than orphan it.
          logForDebugging(
            `[plugin-reconcile] uninstall ${key} did not take (${result.message}); keeping ledger entry`,
          )
        }
      } catch (error) {
        // Keep the ledger entry so the uninstall is retried next startup.
        const message = error instanceof Error ? error.message : String(error)
        logForDebugging(
          `[plugin-reconcile] uninstall ${key} failed, will retry: ${message}`,
        )
      }
    }

    // Nothing favorited remotely → the removal pass was all there was to do.
    if (desired.length === 0) {
      if (mutated) await writeLedger(ledger)
      return
    }

    // ── Install/enable pass. Materialize the one aggregated marketplace once;
    //    if unreachable, nothing can install — persist removals and bail.
    try {
      await ensureAggregatedMarketplace()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logForDebugging(
        `[plugin-reconcile] cannot materialize ${AGGREGATED_MARKETPLACE_NAME} marketplace, skipping installs: ${message}`,
      )
      if (mutated) await writeLedger(ledger)
      return
    }

    // Settings snapshot — compared against the ledger to detect a user's prior
    // manual disable. (`installed` snapshot was taken up front, above.)
    const enabled = enabledPluginsSnapshot()

    for (const plugin of desired) {
      const key = `${plugin.pluginName}@${AGGREGATED_MARKETPLACE_NAME}`
      const prev = ledger.plugins[key]
      try {
        const installedHere = Boolean(installed.plugins[key])

        // ── Case A: not installed → first-time favorite ──
        if (!installedHere) {
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
  } catch (error) {
    // Never let a flaky cloud API or plugin op break startup; log for diagnosis.
    logForDebugging(
      `[plugin-reconcile] aborted: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
