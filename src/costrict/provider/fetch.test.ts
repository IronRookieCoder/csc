import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

type FetchCall = {
  input: RequestInfo | URL
  requestId: string
}

const savedFetch = globalThis.fetch
const fetchCalls: FetchCall[] = []
let fetchResponses: Response[] = []
let savedCredentials: unknown

function getRequestId(call: FetchCall): string {
  return call.requestId
}

function expectUuidV7(value: string): void {
  expect(value).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
}

mock.module('./credentials.js', () => ({
  loadCoStrictCredentials: async () => ({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    state: 'state',
    machine_id: 'machine-id',
    base_url: 'https://costrict.test',
    expiry_date: Date.now() + 60 * 60 * 1000,
    updated_at: new Date().toISOString(),
  }),
  saveCoStrictCredentials: async (credentials: unknown) => {
    savedCredentials = credentials
  },
}))

mock.module('./token.js', () => ({
  isCoStrictTokenValid: () => true,
  refreshCoStrictToken: async () => ({
    access_token: 'refreshed-access-token',
    refresh_token: 'refreshed-refresh-token',
  }),
  extractExpiryFromJWT: () => Date.now() + 60 * 60 * 1000,
}))

describe('createCoStrictFetch', () => {
  beforeEach(() => {
    fetchCalls.length = 0
    fetchResponses = []
    savedCredentials = undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        input,
        requestId: new Headers(init?.headers).get('X-Request-ID') ?? '',
      })
      return fetchResponses.shift() ?? new Response('{}')
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = savedFetch
  })

  test('sets X-Request-ID to UUID v7', async () => {
    const { createCoStrictFetch } = await import('./fetch.js')
    const costrictFetch = createCoStrictFetch()

    await costrictFetch('https://api.test/chat')

    expect(fetchCalls).toHaveLength(1)
    expectUuidV7(getRequestId(fetchCalls[0]!))
  })

  test('uses a new UUID v7 request ID when retrying after 401', async () => {
    fetchResponses = [new Response('{}', { status: 401 }), new Response('{}')]
    const { createCoStrictFetch } = await import('./fetch.js')
    const costrictFetch = createCoStrictFetch()

    await costrictFetch('https://api.test/chat')

    expect(fetchCalls).toHaveLength(2)
    const firstRequestId = getRequestId(fetchCalls[0]!)
    const retryRequestId = getRequestId(fetchCalls[1]!)

    expectUuidV7(firstRequestId)
    expectUuidV7(retryRequestId)
    expect(retryRequestId).not.toBe(firstRequestId)
    expect(savedCredentials).toBeDefined()
  })
})
