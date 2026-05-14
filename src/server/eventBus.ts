export type SSEWriter = {
  writeSSE: (opts: { event: string; data: string }) => Promise<void>
}

type SSEClient = {
  id: string
  writer: SSEWriter | null
  rawWrite: ((event: string, data: unknown) => void) | null
  sessionIdFilter?: string
  cwdFilter?: string
}

type BusEvent = {
  event: string
  data: unknown
}

export class EventBus {
  private clients = new Map<string, SSEClient>()
  private buffer: BusEvent[] = []
  private bufferSize = 100
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private sessionCwds = new Map<string, string>()

  registerSessionCwd(sessionId: string, cwd: string): void {
    this.sessionCwds.set(sessionId, cwd)
  }

  unregisterSessionCwd(sessionId: string): void {
    this.sessionCwds.delete(sessionId)
  }

  addClient(writer: SSEWriter, sessionIdFilter?: string, cwdFilter?: string): string {
    const id = crypto.randomUUID()
    const client: SSEClient = { id, writer, rawWrite: null, sessionIdFilter, cwdFilter }
    this.clients.set(id, client)

    const sendAndCleanup = (opts: { event: string; data: string }) =>
      writer.writeSSE(opts).catch(() => {
        this.clients.delete(id)
      })

    void sendAndCleanup({
      event: 'connected',
      data: JSON.stringify({ type: 'server.connected' }),
    })

    return id
  }

  removeClient(id: string): void {
    this.clients.delete(id)
  }

  publish(event: string, data: unknown): void {
    const entry: BusEvent = { event, data }
    this.buffer.push(entry)
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift()
    }
    const payload = JSON.stringify(data)
    const deadIds: string[] = []
    let clientCount = 0
    for (const client of this.clients.values()) {
      if (client.writer) {
        if (client.sessionIdFilter) {
          const dataObj = data as Record<string, unknown> | undefined
          if (dataObj?.session_id && dataObj.session_id !== client.sessionIdFilter) {
            continue
          }
        }
        if (client.cwdFilter) {
          const dataObj = data as Record<string, unknown> | undefined
          const sid = dataObj?.session_id ?? dataObj?.sessionID
          if (typeof sid === 'string') {
            const sessionCwd = this.sessionCwds.get(sid)
            if (sessionCwd && sessionCwd !== client.cwdFilter) {
              continue
            }
          }
        }
        clientCount++
        client.writer.writeSSE({ event, data: payload }).catch(() => {
          deadIds.push(client.id)
        })
      }
    }
    if (deadIds.length > 0) {
      for (const id of deadIds) {
        this.clients.delete(id)
      }
    }
  }

  publishSessionEvent(
    sessionId: string,
    event: string,
    data: Record<string, unknown>,
  ): void {
    this.publish(`session.${event}`, { session_id: sessionId, ...data })
  }

  startHeartbeat(intervalMs = 10000): void {
    this.heartbeatInterval = setInterval(() => {
      this.publish('heartbeat', {
        type: 'server.heartbeat',
        ts: Date.now(),
      })
    }, intervalMs)
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  clientCount(): number {
    return this.clients.size
  }

  destroy(): void {
    this.stopHeartbeat()
    this.clients.clear()
    this.buffer.length = 0
  }
}
