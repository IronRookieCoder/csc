import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, Dialog } from '@anthropic/ink';
import { SelectMulti } from '../../components/CustomSelect/SelectMulti.js';
import {
  listFavoriteItems,
  loadFavoriteItem,
  unloadFavoriteItem,
  type FavoriteItemWithStatus,
} from '../../costrict/favorite/favorite.js';
import { useSetAppState } from '../../state/AppState.js';
import { getOriginalCwd } from '../../bootstrap/state.js';
import type { LocalJSXCommandCall } from '../../types/command.js';

function CloudEnabledMenu({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: 'skip' | 'system' | 'user' }) => void;
}): React.ReactNode {
  const setAppState = useSetAppState();
  const [items, setItems] = useState<FavoriteItemWithStatus[] | null>(null);
  const previousSlugs = useRef<Set<string>>(new Set());
  const isFirstChange = useRef(true);

  useEffect(() => {
    let cancelled = false;
    listFavoriteItems()
      .then(data => {
        if (cancelled) return;
        if (data.length === 0) {
          onDone('No cloud favorites found', { display: 'system' });
        } else {
          setItems(data);
          previousSlugs.current = new Set(data.filter(item => item.status === 'Active').map(item => item.slug));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        onDone(`Failed to load cloud favorites: ${message}`, {
          display: 'system',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [onDone]);

  const handleCancel = () => {
    onDone('Cancelled', { display: 'system' });
  };

  const options = useMemo(
    () =>
      (items ?? []).map(item => ({
        label: `[${item.itemType}] ${item.name} (${item.status})`,
        value: item.slug,
      })),
    [items],
  );

  const defaultValue = useMemo(
    () => (items ?? []).filter(item => item.status === 'Active').map(item => item.slug),
    [items],
  );

  const handleChange = async (selectedSlugs: string[]) => {
    if (isFirstChange.current) {
      isFirstChange.current = false;
    }

    const prevSet = previousSlugs.current;
    const nextSet = new Set(selectedSlugs);

    const toLoad = (items ?? []).filter(item => nextSet.has(item.slug) && !prevSet.has(item.slug));
    const toUnload = (items ?? []).filter(item => !nextSet.has(item.slug) && prevSet.has(item.slug));

    previousSlugs.current = nextSet;

    if (toLoad.length === 0 && toUnload.length === 0) return;

    const hasMcpChanges = [...toLoad, ...toUnload].some(item => item.itemType === 'mcp');
    const hasAgentChanges = [...toLoad, ...toUnload].some(item => item.itemType === 'agent');

    const results = await Promise.allSettled([
      ...toLoad.map(item => loadFavoriteItem(item.slug)),
      ...toUnload.map(item => unloadFavoriteItem(item.slug)),
    ]);

    // Trigger MCP reconnection if any MCP servers were added or removed
    if (hasMcpChanges) {
      setAppState(prev => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          pluginReconnectKey: prev.mcp.pluginReconnectKey + 1,
        },
      }));
    }

    // Refresh agent definitions if any agents were added or removed
    if (hasAgentChanges) {
      const { getAgentDefinitionsWithOverrides, getActiveAgentsFromList } = await import(
        '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js'
      );
      getAgentDefinitionsWithOverrides.cache?.clear?.();
      const freshAgentDefs = await getAgentDefinitionsWithOverrides(getOriginalCwd());
      setAppState(prev => ({
        ...prev,
        agentDefinitions: {
          ...freshAgentDefs,
          allAgents: freshAgentDefs.allAgents,
          activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
        },
      }));
    }

    const failures = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    if (failures.length > 0) {
      const reasons = failures.map(r => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
      onDone(`Cloud enabled items updated with ${failures.length} errors: ${reasons.join('; ')}`, {
        display: 'system',
      });
    }
  };

  if (items === null) {
    return (
      <Dialog
        title="Cloud Enabled Items"
        subtitle="Toggle items to enable/disable (auto-download on enable)"
        onCancel={handleCancel}
      >
        <Box>
          <Text>Loading cloud favorites...</Text>
        </Box>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Cloud Enabled Items"
      subtitle="Toggle items to enable/disable (auto-download on enable)"
      onCancel={handleCancel}
    >
      <SelectMulti
        key="knowledge-hub-loaded"
        options={options}
        defaultValue={defaultValue}
        onChange={handleChange}
        onCancel={handleCancel}
        hideIndexes
      />
    </Dialog>
  );
}

export const call: LocalJSXCommandCall = async onDone => {
  return <CloudEnabledMenu onDone={onDone} />;
};
