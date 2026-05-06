import { Hono } from 'hono'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getCommands } from '../../commands.js'
import { getCommandName } from '../../types/command.js'
import type { SessionManager } from '../sessionManager.js'
import type { InitData } from '../sessionHandle.js'

export function createInfoRoutes(sessionManager: SessionManager): Hono {
  return new Hono()
    .get('/path', c => {
      return c.json({
        home: homedir(),
        state: getClaudeConfigHomeDir(),
        config: getClaudeConfigHomeDir(),
        directory: process.cwd(),
      })
    })
    .get('/vcs', c => {
      let branch = ''
      try {
        branch = execSync('git rev-parse --abbrev-ref HEAD', {
          encoding: 'utf-8',
          timeout: 5000,
        }).trim()
      } catch {}
      return c.json({ branch })
    })
    .get('/command', async c => {
      try {
        const commands = await getCommands(process.cwd())
        return c.json(
          commands
            .filter(cmd => !cmd.isHidden)
            .map(cmd => ({
              name: getCommandName(cmd),
              description: cmd.description,
              argumentHint: cmd.argumentHint,
            })),
        )
      } catch {
        return c.json([])
      }
    })
    .get('/agent', c => {
      const initData = getFirstInitData(sessionManager)
      if (initData?.agents && initData.agents.length > 0) {
        return c.json(
          initData.agents.map(a => ({
            id: a.name,
            name: a.name,
            description: a.description,
            model: a.model,
          })),
        )
      }
      return c.json([])
    })
    .get('/mcp', async c => {
      for (const handle of sessionManager.getAllSessions()) {
        if (handle.status === 'running') {
          try {
            const servers = await handle.getMcpStatus()
            return c.json({ servers })
          } catch {
            continue
          }
        }
      }
      return c.json({ servers: [] })
    })
}

function getFirstInitData(sessionManager: SessionManager): InitData | null {
  for (const handle of sessionManager.getAllSessions()) {
    if (handle.initData) return handle.initData
  }
  return null
}
