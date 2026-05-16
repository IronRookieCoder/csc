import { describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState'
import {
  createTeammateContext,
  runWithTeammateContext,
} from '../../utils/teammateContext'
import { getAgentNameToPoll, isPollingAsTeamLead } from '../inboxPollerIdentity'

function createLeaderState(): AppState {
  return {
    teamContext: {
      teamName: 'alpha',
      teamFilePath: '/tmp/alpha/config.json',
      leadAgentId: 'team-lead@alpha',
      teammates: {
        'team-lead@alpha': {
          name: 'team-lead',
          tmuxSessionName: '',
          tmuxPaneId: '',
          cwd: '/tmp',
          spawnedAt: 1,
        },
        'worker@alpha': {
          name: 'worker',
          tmuxSessionName: 'in-process',
          tmuxPaneId: 'in-process',
          cwd: '/tmp',
          spawnedAt: 2,
        },
      },
    },
  } as unknown as AppState
}

describe('useInboxPoller identity helpers', () => {
  test('keeps polling as team lead during in-process teammate async context', () => {
    const appState = createLeaderState()
    const teammateContext = createTeammateContext({
      agentId: 'worker@alpha',
      agentName: 'worker',
      teamName: 'alpha',
      planModeRequired: false,
      parentSessionId: 'leader-session',
      abortController: new AbortController(),
    })

    runWithTeammateContext(teammateContext, () => {
      expect(getAgentNameToPoll(appState)).toBe('team-lead')
      expect(isPollingAsTeamLead(appState, 'team-lead')).toBe(true)
    })
  })
})
