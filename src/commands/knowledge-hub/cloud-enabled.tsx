import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pane, Tab, Tabs, Text, useInput, useTabHeaderFocus, useTerminalFocus } from '@anthropic/ink';
import { SearchBox } from '../../components/SearchBox.js';
import { SelectMulti } from '../../components/CustomSelect/SelectMulti.js';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import {
  listFavoriteItems,
  loadFavoriteItem,
  unloadFavoriteItem,
  type FavoriteItemType,
  type FavoriteItemWithStatus,
} from '../../costrict/favorite/favorite.js';
import { useSetAppState } from '../../state/AppState.js';
import { getOriginalCwd } from '../../bootstrap/state.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getCoStrictBaseURL } from '../../costrict/provider/auth.js';

type TabId = FavoriteItemType;

const TAB_CONFIG: { id: TabId; title: string }[] = [
  { id: 'skill', title: 'Skills' },
  { id: 'agent', title: 'Agents' },
  { id: 'command', title: 'Commands' },
  { id: 'mcp', title: 'MCP' },
];

function formatScore(score: number | undefined): string | undefined {
  if (score === undefined) return undefined;
  if (score < 1000) return String(score);
  const k = score / 1000;
  // 如果是整数k，不显示小数；否则保留1位小数
  if (Number.isInteger(k)) return `${k}k`;
  return `${k.toFixed(1)}k`;
}

function TabContent({
  items,
  onChange,
  onCancel,
}: {
  items: FavoriteItemWithStatus[];
  onChange: (selectedSlugs: string[]) => void;
  onCancel: () => void;
}): React.ReactNode {
  const { headerFocused, focusHeader } = useTabHeaderFocus();
  const isTerminalFocused = useTerminalFocus();
  const [isSearchMode, setIsSearchMode] = useState(false);
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset,
  } = useSearchInput({
    isActive: isSearchMode,
    onExit: () => setIsSearchMode(false),
    onCancel: () => {
      setIsSearchMode(false);
      setSearchQuery('');
    },
  });

  // Capture '/' to enter search mode
  useInput(
    (input, _key) => {
      if (!isSearchMode && !headerFocused && input === '/') {
        setIsSearchMode(true);
      }
    },
    { isActive: !isSearchMode && !headerFocused },
  );

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const lower = searchQuery.toLowerCase();
    return items.filter(
      item =>
        item.name.toLowerCase().includes(lower) ||
        item.description.toLowerCase().includes(lower),
    );
  }, [items, searchQuery]);

  const options = useMemo(
    () =>
      filteredItems.map(item => ({
        label: (
          <>
            {item.name}
            {item.score !== undefined && (
              <Text dimColor> · 分值:{formatScore(item.score)}</Text>
            )}
          </>
        ),
        value: item.slug,
        description: item.description || undefined,
      })),
    [filteredItems],
  );

  const defaultValue = useMemo(
    () => filteredItems.filter(item => item.status === 'Active').map(item => item.slug),
    [filteredItems],
  );

  if (items.length === 0) {
    return (
      <Box marginLeft={1}>
        <Text dimColor>No favorites in this category</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      {isSearchMode && (
        <SearchBox
          query={searchQuery}
          isFocused={isSearchMode}
          isTerminalFocused={isTerminalFocused}
          cursorOffset={cursorOffset}
        />
      )}
      {filteredItems.length === 0 && searchQuery && (
        <Box marginLeft={1}>
          <Text dimColor>No favorites match &quot;{searchQuery}&quot;</Text>
        </Box>
      )}
      {filteredItems.length > 0 && (
        <SelectMulti
          options={options}
          defaultValue={defaultValue}
          onChange={onChange}
          onCancel={onCancel}
          isDisabled={headerFocused || isSearchMode}
          onUpFromFirstItem={focusHeader}
          hideIndexes
        />
      )}
      {!isSearchMode && items.length > 0 && (
        <Box marginLeft={1}>
          <Text dimColor italic>type / to search, space/enter to toggle</Text>
        </Box>
      )}
    </Box>
  );
}

function CloudEnabledMenu({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: 'skip' | 'system' | 'user' }) => void;
}): React.ReactNode {
  const setAppState = useSetAppState();
  const [items, setItems] = useState<FavoriteItemWithStatus[] | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('skill');
  const previousSlugs = useRef<Set<string>>(new Set());
  const isFirstChange = useRef(true);

  const storeUrl = useMemo(() => {
    try {
      return `${getCoStrictBaseURL()}/cloud`;
    } catch {
      return 'https://zgsm.sangfor.com/cloud';
    }
  }, []);

  useKeybinding(
    'confirm:no',
    () => {
      onDone('Cancelled', { display: 'system' });
    },
    { context: 'Confirmation' },
  );

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

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId as TabId);
  }, []);

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

    // Optimistically update UI state so tab switching shows correct status
    setItems(prev => {
      if (!prev) return prev;
      const map = new Map(prev.map(i => [i.slug, i]));
      for (const item of toLoad) {
        const existing = map.get(item.slug);
        if (existing) map.set(item.slug, { ...existing, status: 'Active' });
      }
      for (const item of toUnload) {
        const existing = map.get(item.slug);
        if (existing) map.set(item.slug, { ...existing, status: 'Unloaded' });
      }
      return Array.from(map.values());
    });

    const results = await Promise.allSettled([
      ...toLoad.map(item => loadFavoriteItem(item.slug)),
      ...toUnload.map(item => unloadFavoriteItem(item.slug)),
    ]);

    if (hasMcpChanges) {
      setAppState(prev => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          pluginReconnectKey: prev.mcp.pluginReconnectKey + 1,
        },
      }));
    }

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

  const handleCancel = () => {
    onDone('Cancelled', { display: 'system' });
  };

  if (items === null) {
    return (
      <Pane color="suggestion">
        <Box marginLeft={1}>
          <Text>Loading cloud favorites...</Text>
        </Box>
      </Pane>
    );
  }

  return (
    <Pane color="suggestion">
      <Box marginLeft={1} marginBottom={1}>
        <Text dimColor>
          云端订阅项目，如需订阅请访问 {storeUrl}
        </Text>
      </Box>
      <Tabs title="Hub" selectedTab={activeTab} onTabChange={handleTabChange} color="suggestion">
        {TAB_CONFIG.map(tab => (
          <Tab key={tab.id} id={tab.id} title={tab.title}>
            <TabContent
              items={items.filter(item => item.itemType === tab.id)}
              onChange={handleChange}
              onCancel={handleCancel}
            />
          </Tab>
        ))}
      </Tabs>
    </Pane>
  );
}

export const call: LocalJSXCommandCall = async onDone => {
  return <CloudEnabledMenu onDone={onDone} />;
};
