export type NonInteractiveSessionOptions = {
  args: string[]
  forceInteractive: boolean
  stdinIsTTY: boolean | undefined
  stdoutIsTTY: boolean | undefined
}

export function shouldUseNonInteractiveSession({
  args,
  forceInteractive,
  stdinIsTTY,
  stdoutIsTTY,
}: NonInteractiveSessionOptions): boolean {
  if (args.includes('-p') || args.includes('--print')) return true
  if (args.includes('--init-only')) return true
  if (args.some(arg => arg.startsWith('--sdk-url'))) return true

  if (forceInteractive) return false

  const hasInteractiveStdin = stdinIsTTY === true
  const hasInteractiveStdout = stdoutIsTTY === true

  // Some Windows launchers, notably npm's generated PowerShell .ps1 shim,
  // can hide stdout TTY status while stdin is still an interactive terminal.
  // Treat that as interactive so a bare `csc` does not fall into --print mode.
  return !hasInteractiveStdout && !hasInteractiveStdin
}
