import * as React from 'react';
import {
  AgentsMenu,
  mergeRefreshedAgentDefinitions,
} from '../../components/agents/AgentsMenu.js';
import type { ToolUseContext } from '../../Tool.js';
import { getTools } from '../../tools.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
} from '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { getCwd } from '../../utils/cwd.js';

export async function call(onDone: LocalJSXCommandOnDone, context: ToolUseContext): Promise<React.ReactNode> {
  clearAgentDefinitionsCache();
  const freshAgentDefinitions = await getAgentDefinitionsWithOverrides(getCwd());
  context.setAppState(state => ({
    ...state,
    agentDefinitions: mergeRefreshedAgentDefinitions(state.agentDefinitions, freshAgentDefinitions),
  }));

  const appState = context.getAppState();
  const permissionContext = appState.toolPermissionContext;
  const tools = getTools(permissionContext);

  return <AgentsMenu tools={tools} onExit={onDone} />;
}
