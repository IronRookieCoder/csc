/**
 * kill_on_drop: Ensures child processes are killed when their handle is GC'd.
 *
 * Inspired by Rust's tokio `kill_on_drop(true)` pattern. Uses FinalizationRegistry
 * to guarantee cleanup even when explicit kill() is missed (exception, bug, etc.).
 *
 * Two usage modes:
 *
 * 1. Class-based: implement `DisposableChildProcess` on your handle class, then
 *    call `registerKillOnDrop(this, this.child)`. When `this` is GC'd without
 *    `[Symbol.dispose]()` being called, the child is killed.
 *
 * 2. Scoped: use `killOnDrop(child)` with `using` keyword for block-scoped cleanup.
 */

import type { ChildProcess } from 'child_process'
import treeKill from 'tree-kill'

export interface DisposableChildProcess {
  [Symbol.dispose](): void
}

const liveEntries = new WeakMap<DisposableChildProcess, { pid: number | undefined; killed: boolean }>()

const registry = new FinalizationRegistry<{ pid: number | undefined; killed: boolean }>((entry) => {
  if (entry.pid && !entry.killed) {
    try {
      treeKill(entry.pid, 'SIGKILL')
    } catch {
      // Process may have already exited
    }
  }
})

/**
 * Register a child process for automatic cleanup when the owner handle is GC'd.
 *
 * Call this after spawning. The child's 'exit' event auto-unregisters to
 * avoid unnecessary finalization work.
 */
export function registerKillOnDrop(
  owner: DisposableChildProcess,
  child: ChildProcess,
): void {
  const entry = { pid: child.pid, killed: child.killed }
  registry.register(owner, entry, owner)
  liveEntries.set(owner, entry)

  child.once('exit', () => {
    entry.killed = true
    unregisterKillOnDrop(owner)
  })
}

/**
 * Unregister a handle from kill_on_drop. Called automatically when the child
 * exits, or manually when you've explicitly killed the process.
 */
export function unregisterKillOnDrop(owner: DisposableChildProcess): void {
  registry.unregister(owner)
  liveEntries.delete(owner)
}

/**
 * Scoped child process wrapper using `using` keyword.
 * Guarantees kill on scope exit (normal or exception).
 *
 * @example
 * ```ts
 * using guard = killOnDrop(spawn(...))
 * // ... use process ...
 * // automatically killed when scope exits
 * ```
 */
export function killOnDrop(child: ChildProcess): DisposableChildProcess {
  let disposed = false
  const wrapper: DisposableChildProcess = {
    [Symbol.dispose]() {
      if (disposed) return
      disposed = true
      if (child.pid && !child.killed) {
        try {
          treeKill(child.pid, 'SIGKILL')
        } catch {
          // already dead
        }
      }
    },
  }
  child.once('exit', () => {
    disposed = true
  })
  return wrapper
}
