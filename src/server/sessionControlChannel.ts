type PendingEntry = {
  resolve: (response: Record<string, unknown>) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class ControlChannel {
  private pending = new Map<string, PendingEntry>()

  register(requestId: string, timeoutMs = 10000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Control response timed out for ${requestId}`))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timeout })
    })
  }

  tryResolve(msg: { type: string; response?: unknown }): boolean {
    if (msg.type !== 'control_response') return false
    const response = msg.response as Record<string, unknown> | undefined
    const requestId = response?.request_id as string | undefined
    if (!requestId || !this.pending.has(requestId)) return false
    const entry = this.pending.get(requestId)!
    this.pending.delete(requestId)
    clearTimeout(entry.timeout)
    if (response?.subtype === 'error') {
      entry.reject(new Error((response.error as string) ?? 'Unknown error'))
    } else {
      entry.resolve((response?.response ?? {}) as Record<string, unknown>)
    }
    return true
  }

  rejectAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeout)
      entry.reject(error)
    }
    this.pending.clear()
  }
}
