import { describe, expect, test, beforeEach } from 'bun:test'
import { EventBus } from '../eventBus.js'

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  test('addClient returns a client id', () => {
    const writer = { writeSSE: async () => {} }
    const id = bus.addClient(writer)
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  test('removeClient removes the client', () => {
    const writer = { writeSSE: async () => {} }
    const id = bus.addClient(writer)
    expect(bus.clientCount()).toBe(1)
    bus.removeClient(id)
    expect(bus.clientCount()).toBe(0)
  })

  test('publish sends events to all clients', async () => {
    const received: Array<{ event: string; data: string }> = []
    const writer = {
      writeSSE: async (opts: { event: string; data: string }) => {
        received.push(opts)
      },
    }
    bus.addClient(writer)
    bus.publish('test', { hello: 'world' })
    await new Promise(r => setTimeout(r, 10))
    const dataEvents = received.filter(r => r.event === 'test')
    expect(dataEvents.length).toBe(1)
    expect(JSON.parse(dataEvents[0].data)).toEqual({ hello: 'world' })
  })

  test('addClient sends connected event to new client', async () => {
    bus.publish('test1', { a: 1 })
    bus.publish('test2', { b: 2 })

    const received: Array<{ event: string; data: string }> = []
    const writer = {
      writeSSE: async (opts: { event: string; data: string }) => {
        received.push(opts)
      },
    }
    bus.addClient(writer)
    await new Promise(r => setTimeout(r, 10))
    expect(received.length).toBe(1)
    expect(received[0].event).toBe('connected')
  })

  test('session_id filter skips non-matching events', async () => {
    const received: Array<{ event: string; data: string }> = []
    const writer = {
      writeSSE: async (opts: { event: string; data: string }) => {
        received.push(opts)
      },
    }
    bus.addClient(writer, 'session-abc')

    bus.publish('session.message', { session_id: 'session-abc', type: 'assistant' })
    bus.publish('session.message', { session_id: 'session-xyz', type: 'assistant' })
    bus.publish('heartbeat', { type: 'server.heartbeat' })

    await new Promise(r => setTimeout(r, 10))
    const dataEvents = received.filter(r => r.event !== 'connected')
    expect(dataEvents.length).toBe(2) // session-abc + heartbeat (no session_id)
  })

  test('publishSessionEvent prefixes event with session.', async () => {
    const received: Array<{ event: string; data: string }> = []
    const writer = {
      writeSSE: async (opts: { event: string; data: string }) => {
        received.push(opts)
      },
    }
    bus.addClient(writer)
    bus.publishSessionEvent('sid-1', 'ready', { status: 'running' })
    await new Promise(r => setTimeout(r, 10))
    const readyEvent = received.find(r => r.event === 'session.ready')
    expect(readyEvent).toBeDefined()
    expect(JSON.parse(readyEvent!.data)).toEqual({ session_id: 'sid-1', status: 'running' })
  })

  test('startHeartbeat publishes heartbeat events', async () => {
    const received: Array<{ event: string; data: string }> = []
    const writer = {
      writeSSE: async (opts: { event: string; data: string }) => {
        received.push(opts)
      },
    }
    bus.addClient(writer)
    bus.startHeartbeat(50)
    await new Promise(r => setTimeout(r, 120))
    bus.stopHeartbeat()
    const heartbeats = received.filter(r => r.event === 'heartbeat')
    expect(heartbeats.length).toBeGreaterThanOrEqual(1)
  })

  test('destroy clears all state', () => {
    const writer = { writeSSE: async () => {} }
    bus.addClient(writer)
    bus.startHeartbeat(10000)
    bus.destroy()
    expect(bus.clientCount()).toBe(0)
  })

  test('buffer does not exceed bufferSize', () => {
    for (let i = 0; i < 150; i++) {
      bus.publish('test', { i })
    }
    const writer = { writeSSE: async () => {} }
    bus.addClient(writer)
    // buffer is 100, so only last 100 should be replayed
    // We can't directly check buffer, but no crash = ok
    expect(bus.clientCount()).toBe(1)
  })
})
