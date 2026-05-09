import { Hono } from 'hono'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getCommands } from '../../commands.js'
import { getCommandName } from '../../types/command.js'
import type { SessionManager } from '../sessionManager.js'
import { getBuiltInAgents } from '@claude-code-best/builtin-tools/tools/AgentTool/builtInAgents.js'

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
      const allAgents = getBuiltInAgents()
      const defaultMode = {
        name: 'build',
        description: 'Default mode for software engineering tasks: writing code, editing files, running commands, and building projects.',
        mode: 'primary' as const,
        hidden: false,
        options: {},
        permission: [],
      }
      return c.json([
        defaultMode,
        ...allAgents.map(a => ({
          name: a.agentType,
          description: a.whenToUse,
          mode: a.isMainThread ? ('primary' as const) : ('subagent' as const),
          hidden: false,
          options: {},
          permission: [],
        })),
      ])
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
