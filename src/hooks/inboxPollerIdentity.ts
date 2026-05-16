import type { AppState } from '../state/AppState.js'
import { TEAM_LEAD_NAME } from '../utils/swarm/constants.js'
import { getAgentName, isTeammate } from '../utils/teammate.js'
import { isInProcessTeammate } from '../utils/teammateContext.js'

export function getAgentNameToPoll(appState: AppState): string | undefined {
  const teamLeadName = getTeamLeadNameToPoll(appState)

  if (isTeammate() && !isInProcessTeammate()) {
    return getAgentName()
  }

  if (teamLeadName) {
    return teamLeadName
  }

  // In-process teammates should NOT use useInboxPoller - they have their own
  // polling mechanism via waitForNextPromptOrShutdown() in inProcessRunner.ts.
  // Using useInboxPoller would cause message routing issues since in-process
  // teammates share the same React context and AppState with the leader.
  //
  // Note: This can be called when the leader's REPL re-renders while an
  // in-process teammate's AsyncLocalStorage context is active (due to shared
  // setAppState). We return undefined to gracefully skip polling rather than
  // throwing, since this is a normal occurrence during concurrent execution.
  if (isInProcessTeammate()) {
    return undefined
  }
  return undefined
}

function getTeamLeadNameToPoll(appState: AppState): string | undefined {
  const teamContext = appState.teamContext
  if (!teamContext?.leadAgentId) {
    return undefined
  }

  return teamContext.teammates[teamContext.leadAgentId]?.name || TEAM_LEAD_NAME
}

export function isPollingAsTeamLead(
  appState: AppState,
  agentName: string,
): boolean {
  return getTeamLeadNameToPoll(appState) === agentName
}
