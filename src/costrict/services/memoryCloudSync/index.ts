/**
 * Memory Cloud Sync Service
 *
 * Syncs auto-memory files (personal memory) between the local filesystem
 * and the costrict-web cloud API.
 *
 * API contract (costrict-web server/internal/memory):
 *   POST   /api/memories        → create a new memory
 *   PUT    /api/memories/:id    → update an existing memory
 *
 * Sync semantics:
 *   - Initial scan: on startup, scan all .md files, compare against local
 *     .cloud_sync_state.json, upload new/changed files.
 *   - Incremental: file watcher triggers re-scan of changed files.
 *   - Content MD5 comparison prevents redundant uploads.
 *   - Deletions do NOT propagate to the server.
 */

import { createHash } from 'crypto'
import { readdir, readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { getAutoMemPath, isAutoMemoryEnabled } from '../../../memdir/paths.js'
import {
  getCoStrictBaseURL,
} from '../../../costrict/provider/auth.js'
import { loadCoStrictCredentials } from '../../../costrict/provider/credentials.js'
import { parseFrontmatter } from '../../../utils/frontmatterParser.js'
import { getProjectRoot } from '../../../bootstrap/state.js'
import type {
  CloudSyncState,
  CreateMemoryRequest,
  MemoryResponse,
  MemoryUploadResult,
  SyncedFileState,
  UpdateMemoryRequest,
} from './types.js'

const API_TIMEOUT_MS = 30_000

// ─── Auth & endpoint ──────────────────────────────────────────

function getMemoryAPIEndpoint(path: string): string {
  const baseUrl = getCoStrictBaseURL()
  return `${baseUrl}/cloud-api/api/memories${path}`
}

async function getAuthHeaders(): Promise<{
  headers?: Record<string, string>
  error?: string
}> {
  const creds = await loadCoStrictCredentials()
  if (creds?.access_token) {
    return {
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  }
  return { error: 'No CoStrict credentials available' }
}

/**
 * Check if cloud sync can proceed (feature gating is done in watcher).
 */
export function isMemoryCloudSyncAvailable(): boolean {
  return isAutoMemoryEnabled()
}

// ─── State file ────────────────────────────────────────────────

const STATE_FILENAME = '.cloud_sync_state.json'

function getStateFilePath(): string {
  return join(getAutoMemPath(), STATE_FILENAME)
}

export async function loadSyncState(): Promise<CloudSyncState> {
  try {
    const raw = await readFile(getStateFilePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return { items: parsed.items ?? {} }
  } catch {
    return { items: {} }
  }
}

export async function saveSyncState(state: CloudSyncState): Promise<void> {
  await writeFile(
    getStateFilePath(),
    JSON.stringify(state, null, 2) + '\n',
    'utf-8',
  )
}

// ─── Content hash ──────────────────────────────────────────────

export function computeMD5(content: string): string {
  return createHash('md5').update(content, 'utf8').digest('hex')
}

// ─── Upload ────────────────────────────────────────────────────

/**
 * Upload a single memory file to the cloud.
 * Uses POST for new memories, PUT for existing ones.
 */
export async function uploadMemory(
  slug: string,
  content: string,
  existingState?: SyncedFileState,
): Promise<MemoryUploadResult> {
  try {
    const auth = await getAuthHeaders()
    if (auth.error) {
      return {
        success: false,
        slug,
        error: auth.error,
        errorType: 'auth',
      }
    }

    const { frontmatter } = parseFrontmatter(content)
    const name = (frontmatter.name as string) || slug
    const description = (frontmatter.description as string) || ''
    const type = (frontmatter.type as string) || 'user'
    const projectPath = getProjectRoot() || process.cwd()
    const workDir = process.cwd()

    if (existingState?.memoryId) {
      // Existing memory → PUT to update
      const body: UpdateMemoryRequest = {
        name,
        description,
        content,
        bumpVersion: true,
      }

      const url = getMemoryAPIEndpoint(`/${existingState.memoryId}`)
      const response = await fetch(url, {
        method: 'PUT',
        headers: auth.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      })

      if (!response.ok) {
        return {
          success: false,
          slug,
          error: `PUT failed: ${response.status} ${response.statusText}`,
          errorType: response.status >= 500 ? 'network' : 'unknown',
          httpStatus: response.status,
        }
      }

      const data = (await response.json()) as MemoryResponse
      return {
        success: true,
        slug,
        memoryId: data.id,
        version: data.currentVersion,
      }
    }

    // New memory → POST to create
    const body: CreateMemoryRequest = {
      name,
      slug,
      projectPath,
      workDir,
      type,
      description,
      content,
    }

    const url = getMemoryAPIEndpoint('')
    const response = await fetch(url, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })

    if (!response.ok) {
      return {
        success: false,
        slug,
        error: `POST failed: ${response.status} ${response.statusText}`,
        errorType: response.status >= 500 ? 'network' : 'unknown',
        httpStatus: response.status,
      }
    }

    const data = (await response.json()) as MemoryResponse
    return {
      success: true,
      slug,
      memoryId: data.id,
      version: data.currentVersion,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isTimeout =
      message.includes('timeout') || message.includes('aborted')
    return {
      success: false,
      slug,
      error: message,
      errorType: isTimeout ? 'timeout' : 'network',
    }
  }
}

// ─── Full scan & sync ──────────────────────────────────────────

/**
 * Scan all .md files in the auto-memory directory and sync them to the cloud.
 * Skips MEMORY.md and files in logs/ directory.
 * Returns the set of slugs that were successfully synced.
 */
export async function scanAndSync(
  existingState: CloudSyncState,
): Promise<{ results: MemoryUploadResult[]; newState: CloudSyncState }> {
  const memoryDir = getAutoMemPath()
  const newState: CloudSyncState = { items: { ...existingState.items } }
  const results: MemoryUploadResult[] = []

  let entries: string[]
  try {
    entries = await readdir(memoryDir, { recursive: true })
  } catch {
    // Memory dir doesn't exist yet — nothing to sync
    return { results, newState }
  }

  const mdFiles = entries.filter(
    f =>
      f.endsWith('.md') &&
      basename(f) !== 'MEMORY.md' &&
      !f.startsWith('logs/') &&
      !f.startsWith('logs\\'),
  )

  // Process files sequentially to avoid overwhelming the API
  for (const relativePath of mdFiles) {
    const slug = basename(relativePath, '.md')
    const filePath = join(memoryDir, relativePath)

    try {
      const raw = await readFile(filePath, 'utf-8')
      const md5 = computeMD5(raw)
      const existing = newState.items[slug]

      // Skip if content hasn't changed
      if (existing && existing.contentMD5 === md5) {
        continue
      }

      const result = await uploadMemory(slug, raw, existing)

      if (result.success && result.memoryId) {
        newState.items[slug] = {
          memoryId: result.memoryId,
          contentMD5: md5,
          version: result.version ?? (existing?.version ?? 0) + 1,
        }
      }

      results.push(result)
    } catch (err) {
      results.push({
        success: false,
        slug,
        error: err instanceof Error ? err.message : String(err),
        errorType: 'unknown',
      })
    }
  }

  return { results, newState }
}