/**
 * Memory Cloud Sync Types
 *
 * Type definitions for the memory cloud sync API, which uploads
 * auto-memory files to the costrict-web /api/memories endpoint.
 */

/**
 * POST /api/memories request body
 */
export type CreateMemoryRequest = {
  name: string
  slug: string
  projectPath: string
  workDir: string
  type: string
  description: string
  content: string
}

/**
 * PUT /api/memories/:id request body
 */
export type UpdateMemoryRequest = {
  name?: string
  description?: string
  content?: string
  bumpVersion: boolean
}

/**
 * Response from creating or fetching a memory
 */
export type MemoryResponse = {
  id: string
  userId: string
  projectPath: string
  slug: string
  name: string
  type: string
  description?: string
  currentVersion: number
  createdAt: string
  updatedAt: string
}

/**
 * Per-file sync state stored in .cloud_sync_state.json
 */
export type SyncedFileState = {
  /** Server-side memory ID */
  memoryId: string
  /** MD5 hash of the file content at last sync */
  contentMD5: string
  /** Server-side version number */
  version: number
}

/**
 * Full sync state file content
 */
export type CloudSyncState = {
  items: Record<string, SyncedFileState>
}

/**
 * Result of uploading a single memory file
 */
export type MemoryUploadResult = {
  success: boolean
  slug: string
  memoryId?: string
  version?: number
  error?: string
  errorType?: 'auth' | 'network' | 'timeout' | 'unknown'
  httpStatus?: number
}