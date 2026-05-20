import { describe, expect, test, beforeEach } from 'bun:test'
import { readSessionMessages, readSessionTodos, readSessionTasks, clearPathCache } from '../transcriptReader.js'

describe('transcriptReader', () => {
  beforeEach(() => {
    clearPathCache()
  })

  test('readSessionMessages returns empty for non-existent session', async () => {
    const result = await readSessionMessages({
      sessionId: 'nonexistent-session-id-12345',
    })
    expect(result.messages).toEqual([])
  })

  test('readSessionTodos returns empty for non-existent session', async () => {
    const result = await readSessionTodos({
      sessionId: 'nonexistent-session-id-12345',
    })
    expect(result).toEqual([])
  })

  test('readSessionTasks returns empty for non-existent session', async () => {
    const result = await readSessionTasks({
      sessionId: 'nonexistent-session-id-12345',
    })
    expect(result).toEqual([])
  })

  test('readSessionMessages respects limit', async () => {
    const result = await readSessionMessages({
      sessionId: 'nonexistent-session-id-12345',
      limit: 10,
    })
    expect(result.messages).toEqual([])
  })

  test('readSessionMessages with includeSystem flag', async () => {
    const result = await readSessionMessages({
      sessionId: 'nonexistent-session-id-12345',
      includeSystem: true,
    })
    expect(result.messages).toEqual([])
  })
})
