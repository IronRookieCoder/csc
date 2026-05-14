/**
 * Raw Dump 主入口
 * 队列模式：主进程只 enqueue，单 batch worker 顺序消费
 */

import { isLocalDumpMode } from './localStorage.js'
import { enqueue } from './queue.js'
import { spawnBatchWorker } from './spawn.js'
import { startBatchWorker } from './batchWorker.js'
import { createLogger } from './logger.js'

const log = createLogger('raw-dump')

let batchWorkerSpawned = false

// 调用频率限制：同一 session + messageID 5s 内不重复 enqueue
const lastEnqueueMap = new Map<string, number>()
const ENQUEUE_DEBOUNCE_MS = 5_000

function isEnabled(): boolean {
  // 本地调试模式自动启用
  if (isLocalDumpMode()) return true
  // 显式禁用
  if (process.env.CSC_DISABLE_RAW_DUMP === '1' || process.env.CSC_DISABLE_RAW_DUMP === 'true') return false
  if (process.env.COSTRICT_DISABLE_RAW_DUMP === '1' || process.env.COSTRICT_DISABLE_RAW_DUMP === 'true') return false
  // 默认启用 raw dump
  return true
}

function ensureBatchWorker() {
  if (batchWorkerSpawned) return
  batchWorkerSpawned = true
  const spawned = spawnBatchWorker()
  if (!spawned) {
    log.warn('batch worker spawn failed, falling back to inline worker')
    startBatchWorker()
  }
}

function shouldEnqueue(sessionID: string, messageID: string): boolean {
  const key = `${sessionID}:${messageID}`
  const now = Date.now()
  const last = lastEnqueueMap.get(key)
  if (last && now - last < ENQUEUE_DEBOUNCE_MS) {
    log.debug('reportTurn debounced', { sessionID, messageID, lastMs: now - last })
    return false
  }
  lastEnqueueMap.set(key, now)
  return true
}

/**
 * 上报一轮对话
 * 只写入队列，由 batch worker 顺序消费
 */
export function reportTurn(sessionID: string, messageID: string, directory: string): void {
  if (!isEnabled()) return
  if (!shouldEnqueue(sessionID, messageID)) return
  enqueue({ sessionID, messageID, directory })
  ensureBatchWorker()
}

export function reportSession(sessionID: string, directory: string): void {
  if (!isEnabled()) return
  if (!shouldEnqueue(sessionID, '__summary__')) return
  enqueue({ sessionID, messageID: '__summary__', directory })
  ensureBatchWorker()
}
