import { randomBytes, type UUID } from 'crypto'
import type { AgentId } from 'src/types/ids.js'

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validate uuid
 * @param maybeUUID The value to be checked if it is a uuid
 * @returns string as UUID or null if it is not valid
 */
export function validateUuid(maybeUuid: unknown): UUID | null {
  // UUID format: 8-4-4-4-12 hex digits
  if (typeof maybeUuid !== 'string') return null

  return uuidRegex.test(maybeUuid) ? (maybeUuid as UUID) : null
}

/**
 * Generate an RFC 9562 UUID v7.
 *
 * UUID v7 keeps the Unix millisecond timestamp in the first 48 bits, which
 * makes request IDs sortable while preserving UUID compatibility.
 */
export function createUuidV7(): UUID {
  const bytes = randomBytes(16)
  let timestamp = BigInt(Date.now())

  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(timestamp & 0xffn)
    timestamp >>= 8n
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as UUID
}

/**
 * Generate a new agent ID with prefix for consistency with task IDs.
 * Format: a{label-}{16 hex chars}
 * Example: aa3f2c1b4d5e6f7a8, acompact-a3f2c1b4d5e6f7a8
 */
export function createAgentId(label?: string): AgentId {
  const suffix = randomBytes(8).toString('hex')
  return (label ? `a${label}-${suffix}` : `a${suffix}`) as AgentId
}
