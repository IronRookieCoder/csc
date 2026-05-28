import { describe, expect, test } from 'bun:test'
import { validateUuid, createAgentId, createUuidV7 } from '../uuid'

describe('validateUuid', () => {
  test('validates correct UUID', () => {
    const result = validateUuid('550e8400-e29b-41d4-a716-446655440000')
    expect(result).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  test('validates uppercase UUID', () => {
    const result = validateUuid('550E8400-E29B-41D4-A716-446655440000')
    expect(result).toBe('550E8400-E29B-41D4-A716-446655440000')
  })

  test('returns null for non-string', () => {
    expect(validateUuid(123)).toBeNull()
    expect(validateUuid(null)).toBeNull()
    expect(validateUuid(undefined)).toBeNull()
  })

  test('returns null for invalid UUID format', () => {
    expect(validateUuid('not-a-uuid')).toBeNull()
    expect(validateUuid('550e8400-e29b-41d4-a716')).toBeNull()
    expect(validateUuid('550e8400e29b41d4a716446655440000')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(validateUuid('')).toBeNull()
  })

  test('returns null for UUID with invalid chars', () => {
    expect(validateUuid('550e8400-e29b-41d4-a716-44665544000g')).toBeNull()
  })

  test('returns null for UUID with leading/trailing whitespace', () => {
    expect(validateUuid(' 550e8400-e29b-41d4-a716-446655440000')).toBeNull()
    expect(validateUuid('550e8400-e29b-41d4-a716-446655440000 ')).toBeNull()
  })
})

describe('createAgentId', () => {
  test('generates id without label in correct format', () => {
    const id = createAgentId()
    expect(id).toMatch(/^a[0-9a-f]{16}$/)
  })

  test('generates id with label in correct format', () => {
    const id = createAgentId('compact')
    expect(id).toMatch(/^acompact-[0-9a-f]{16}$/)
  })
})

describe('createUuidV7', () => {
  test('generates an RFC-compatible UUID v7', () => {
    const id = createUuidV7()

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(validateUuid(id)).toBe(id)
  })

  test('encodes the current unix millisecond timestamp', () => {
    const before = Date.now()
    const id = createUuidV7()
    const after = Date.now()
    const timestamp = Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16)

    expect(timestamp).toBeGreaterThanOrEqual(before)
    expect(timestamp).toBeLessThanOrEqual(after)
  })
})
