/**
 * Memory Cloud Sync File Watcher
 *
 * On startup: scans all existing .md files and syncs them to the cloud.
 * After startup: watches the auto-memory directory for changes and triggers
 * a debounced push to the server when files are modified.
 */

import { type FSWatcher, watch } from 'fs'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { getAutoMemPath, isAutoMemoryEnabled } from '../../../memdir/paths.js'
import { loadCoStrictCredentials } from '../../../costrict/provider/credentials.js'
import { registerCleanup } from '../../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../../utils/debug.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { errorMessage } from '../../../utils/errors.js'
import { isProcessRunning } from '../../../utils/genericProcessUtils.js'
import {
  loadSyncState,
  saveSyncState,
  scanAndSync,
} from './index.js'

const DEBOUNCE_MS = 10_000 // Wait 10s after last change before pushing
const LOCK_FILE = '.cloud_sync.lock'
// PID recycling guard: if the lock is older than this, reclaim even if PID is alive
const LOCK_STALE_MS = 60 * 60 * 1000 // 1 hour

// ─── Watcher state ─────────────────────────────────────────────
let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pushInProgress = false
let hasPendingChanges = false
let watcherStarted = false
let lockAcquired = false

// ─── Process lock ─────────────────────────────────────────────

function lockPath(): string {
  return join(getAutoMemPath(), LOCK_FILE)
}

/**
 * Try to acquire the cloud sync lock. Only one process per project should
 * run the watcher — others skip to avoid duplicating uploads and corrupting
 * the shared .cloud_sync_state.json.
 */
async function tryAcquireLock(): Promise<boolean> {
  const path = lockPath()
  try {
    const raw = await readFile(path, 'utf8')
    const holderPid = parseInt(raw.trim(), 10)

    if (Number.isFinite(holderPid) && isProcessRunning(holderPid)) {
      const stat = await import('fs/promises').then(m => m.stat(path))
      const age = Date.now() - stat.mtimeMs
      if (age < LOCK_STALE_MS) {
        logForDebugging(
          `memory-cloud-sync: lock held by live PID ${holderPid}, skipping`,
          { level: 'debug' },
        )
        return false
      }
      // Lock is stale — reclaim below
    }
  } catch {
    // ENOENT — no prior lock, proceed
  }

  await mkdir(getAutoMemPath(), { recursive: true })
  await writeFile(path, String(process.pid))

  // Re-read to verify we won the race
  const verify = await readFile(path, 'utf8')
  if (parseInt(verify.trim(), 10) !== process.pid) {
    logForDebugging(
      'memory-cloud-sync: lost lock race, skipping',
      { level: 'debug' },
    )
    return false
  }

  return true
}

async function releaseLock(): Promise<void> {
  if (!lockAcquired) return
  try {
    const path = lockPath()
    const raw = await readFile(path, 'utf8')
    if (parseInt(raw.trim(), 10) === process.pid) {
      await unlink(path)
    }
  } catch {
    // Best-effort
  }
  lockAcquired = false
}

/**
 * Execute the push: re-scan all files and upload changed ones.
 */
async function executePush(): Promise<void> {
  pushInProgress = true
  try {
    const state = await loadSyncState()
    const { results, newState } = await scanAndSync(state)
    await saveSyncState(newState)

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    if (succeeded > 0 || failed > 0) {
      logForDebugging(
        `memory-cloud-sync: pushed ${succeeded} files${
          failed > 0 ? `, ${failed} failed` : ''
        }`,
        { level: 'info' },
      )
    }

    if (failed === 0) {
      hasPendingChanges = false
    }

    // Log individual failures for debugging
    for (const r of results) {
      if (!r.success) {
        logForDebugging(
          `memory-cloud-sync: upload failed for "${r.slug}": ${r.error}`,
          { level: 'warn' },
        )
      }
    }
  } catch (e) {
    logForDebugging(`memory-cloud-sync: push error: ${errorMessage(e)}`, {
      level: 'warn',
    })
  } finally {
    pushInProgress = false
  }
}

/**
 * Debounced push: waits for writes to settle, then pushes once.
 */
function schedulePush(): void {
  hasPendingChanges = true
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (pushInProgress) {
      // A push is already running — mark pending and let it pick up
      // the new changes on its next iteration
      hasPendingChanges = true
      return
    }
    void executePush()
  }, DEBOUNCE_MS)
}

/**
 * Start watching the auto-memory directory for changes.
 */
async function startFileWatcher(memoryDir: string): Promise<void> {
  if (watcherStarted) {
    return
  }
  watcherStarted = true

  try {
    await mkdir(memoryDir, { recursive: true })

    watcher = watch(
      memoryDir,
      { persistent: true, recursive: true },
      (_eventType, _filename) => {
        schedulePush()
      },
    )
    watcher.on('error', err => {
      logForDebugging(
        `memory-cloud-sync: fs.watch error: ${errorMessage(err)}`,
        { level: 'warn' },
      )
    })
    logForDebugging(`memory-cloud-sync: watching ${memoryDir}`, {
      level: 'debug',
    })
  } catch (err) {
    logForDebugging(
      `memory-cloud-sync: failed to watch ${memoryDir}: ${errorMessage(err)}`,
      { level: 'warn' },
    )
  }

  registerCleanup(async () => stopMemoryCloudWatcher())
}

/**
 * Start the memory cloud sync system.
 *
 * Enabled by default. Set DISABLE_MEMORY_CLOUD_SYNC=1 to opt out.
 *
 * Returns early if:
 *   - DISABLE_MEMORY_CLOUD_SYNC env var is truthy
 *   - auto memory is disabled
 *   - user has no CoStrict credentials
 *
 * On start: performs a full scan of existing memory files and uploads
 * any that are new or changed. Then starts the file watcher.
 */
export async function startMemoryCloudWatcher(): Promise<void> {
  if (isEnvTruthy(process.env.DISABLE_MEMORY_CLOUD_SYNC)) {
    logForDebugging(
      'memory-cloud-sync: disabled via DISABLE_MEMORY_CLOUD_SYNC',
      { level: 'debug' },
    )
    return
  }
  if (!isAutoMemoryEnabled()) {
    logForDebugging(
      'memory-cloud-sync: auto memory disabled, skipping',
      { level: 'debug' },
    )
    return
  }

  const creds = await loadCoStrictCredentials()
  if (!creds?.access_token) {
    logForDebugging(
      'memory-cloud-sync: no CoStrict credentials, skipping',
      { level: 'debug' },
    )
    return
  }

  const memoryDir = getAutoMemPath()

  // Acquire process lock — only one watcher per project
  const gotLock = await tryAcquireLock()
  if (!gotLock) {
    return
  }
  lockAcquired = true

  logForDebugging(
    `memory-cloud-sync: starting initial scan of ${memoryDir}`,
    { level: 'info' },
  )

  // ── Initial full scan ──────────────────────────────────────────
  try {
    const state = await loadSyncState()
    const { results, newState } = await scanAndSync(state)
    await saveSyncState(newState)

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    logForDebugging(
      `memory-cloud-sync: initial scan complete — ${succeeded} uploaded${
        failed > 0 ? `, ${failed} failed` : ''
      }`,
      { level: 'info' },
    )
  } catch (err) {
    logForDebugging(
      `memory-cloud-sync: initial scan failed: ${errorMessage(err)}`,
      { level: 'warn' },
    )
  }

  // ── Start file watcher ─────────────────────────────────────────
  await startFileWatcher(memoryDir)
}

/**
 * Stop the file watcher and flush pending changes.
 */
export async function stopMemoryCloudWatcher(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
  }
  // Flush pending changes
  if (hasPendingChanges) {
    try {
      await executePush()
    } catch {
      // Best-effort during shutdown
    }
  }
  await releaseLock()
}

/**
 * Test-only: reset module state for test isolation.
 */
export function _resetWatcherStateForTesting(): void {
  watcher = null
  debounceTimer = null
  pushInProgress = false
  hasPendingChanges = false
  watcherStarted = false
}