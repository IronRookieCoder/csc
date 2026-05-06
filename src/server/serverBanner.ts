import type { ServerConfig } from './types.js'

export function printBanner(
  config: ServerConfig,
  authToken: string | undefined,
  actualPort: number,
): void {
  const url = config.unix
    ? `unix:${config.unix}`
    : `http://${config.host}:${actualPort}`

  process.stderr.write(`\ncsc server listening on ${url}\n`)

  // Auth token display intentionally disabled while serve auth is disabled.

  process.stderr.write(`Max sessions: ${config.maxSessions ?? 32}\n`)
  process.stderr.write(`Workspace: ${config.workspace || process.cwd()}\n\n`)
}
