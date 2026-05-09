/**
 * Raw Dump Batch Worker
 * 顺序消费队列，避免并发 429
 * 独立进程，通过 setInterval 定期执行
 */

import { uploadConversation, uploadSummary, uploadCommits, auth } from './worker.js'
import { readQueue, clearQueue, acquireLock, releaseLock, type QueueTask } from './queue.js'
import { readState, writeState } from './state.js'
import { getSessionDirectory, loadSessionMessages } from './worker.js'
import { createLogger } from './logger.js'

const log = createLogger('raw-dump-batch')

const BATCH_INTERVAL_MS = 30_000 // 30 秒检查一次队列

async function processTask(task: QueueTask) {
  log('info', 'processing task', { sessionID: task.sessionID, messageID: task.messageID })

  const sessionDir = getSessionDirectory(task.directory, task.sessionID)
  const messages = await loadSessionMessages(sessionDir, task.sessionID, task.messageID)

  if (messages.length === 0) {
    log('warn', 'no messages found', { sessionDir, sessionID: task.sessionID })
  }

  const authData = await auth()
  const state = await readState()

  try {
    // conversation
    const conversationUploaded = await uploadConversation(
      { sessionID: task.sessionID, messageID: task.messageID, directory: task.directory, messages },
      authData,
      state,
    )

    // summary（每个 turn 都报，但内容会累积）
    await uploadSummary({ sessionID: task.sessionID, directory: task.directory, messages }, authData)

    // commits（限制频率，避免重复上报）
    await uploadCommits({ directory: task.directory }, authData, state)

    log('info', 'task completed', { sessionID: task.sessionID, conversationUploaded })
  } finally {
    // 无论成功或失败，都写入 state（commits 已逐条更新）
    await writeState(state)
  }
}

async function runBatch() {
  if (!acquireLock()) {
    log('debug', 'another worker is running, skip')
    return
  }

  try {
    const tasks = readQueue()
    if (tasks.length === 0) {
      log('debug', 'queue empty')
      return
    }

    log('info', `processing ${tasks.length} tasks`)

    // 去重：同一个 session 的多个 task，只保留最新的一个
    const deduped = new Map<string, QueueTask>()
    for (const task of tasks) {
      const key = `${task.sessionID}:${task.messageID}`
      const existing = deduped.get(key)
      if (!existing || task.enqueuedAt > existing.enqueuedAt) {
        deduped.set(key, task)
      }
    }

    const uniqueTasks = Array.from(deduped.values()).sort((a, b) => a.enqueuedAt - b.enqueuedAt)
    log('info', `deduped to ${uniqueTasks.length} unique tasks`)

    for (const task of uniqueTasks) {
      try {
        await processTask(task)
      } catch (err) {
        log('error', 'task failed', { error: err instanceof Error ? err.message : String(err), sessionID: task.sessionID })
      }
    }

    clearQueue()
    log('info', 'batch completed')
  } finally {
    releaseLock()
  }
}

export function startBatchWorker() {
  log('info', 'batch worker started', { interval: BATCH_INTERVAL_MS })

  // 立即执行一次
  void runBatch()

  // 定期执行，添加随机抖动避免规律性 429
  const jitter = Math.floor(Math.random() * 10_000)
  setTimeout(() => {
    void runBatch()
    setInterval(() => {
      void runBatch()
    }, BATCH_INTERVAL_MS)
  }, jitter)
}

// 如果直接运行此文件
if (process.argv[1]?.includes('batchWorker')) {
  startBatchWorker()
}
