import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Dialog, Pane, Tab, Tabs, Text, useInput, useTabHeaderFocus, useTerminalFocus } from '@anthropic/ink';
import { SearchBox } from '../../components/SearchBox.js';
import { Select } from '../../components/CustomSelect/select.js';
import { SelectMulti } from '../../components/CustomSelect/SelectMulti.js';
import { Spinner } from '../../components/Spinner.js';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import {
  listFavoriteItems,
  loadFavoriteItem,
  unloadFavoriteItem,
  getHubSyncMode,
  findOrphanedFavoriteItems,
  batchUnloadFavoriteItems,
  type FavoriteItemType,
  type FavoriteItemWithStatus,
  type OrphanedFavoriteItem,
} from '../../costrict/favorite/favorite.js';
import { useSetAppState } from '../../state/AppState.js';
import { getOriginalCwd } from '../../bootstrap/state.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getCoStrictBaseURL } from '../../costrict/provider/auth.js';

type TabId = FavoriteItemType;

type SyncPhase = 'loading' | 'checking' | 'confirming' | 'syncing' | 'ready';

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

function SyncConfirmDialog({
  orphanedItems,
  onConfirm,
  onSkip,
}: {
  orphanedItems: OrphanedFavoriteItem[];
  onConfirm: () => void;
  onSkip: () => void;
}): React.ReactNode {
  const typeLabel: Record<FavoriteItemType, string> = {
    skill: 'Skill',
    agent: 'Agent',
    command: 'Command',
    mcp: 'MCP',
  };

  const options = [
    {
      label: `卸载全部 (${orphanedItems.length} 项)`,
      value: 'unload',
      description: '从本地移除这些已取消云端收藏的项目',
    },
    {
      label: '保留本地配置',
      value: 'keep',
      description: '暂不卸载，继续在本地使用',
    },
  ];

  const handleSelect = (value: string) => {
    if (value === 'unload') {
      onConfirm();
    } else {
      onSkip();
    }
  };

  const handleCancel = () => {
    onSkip();
  };

  return (
    <Dialog
      title="云端收藏已更新"
      subtitle={`检测到 ${orphanedItems.length} 个项目已从云端取消收藏，但本地仍保持激活：`}
      onCancel={handleCancel}
      color="warning"
    >
      <Box flexDirection="column" gap={0} marginBottom={1}>
        {orphanedItems.map(item => (
          <Box key={item.slug} marginLeft={1}>
            <Text dimColor>
              • {item.name} ({typeLabel[item.itemType]})
            </Text>
          </Box>
        ))}
      </Box>
      <Select options={options} onChange={handleSelect} defaultFocusValue="unload" />
    </Dialog>
  );
}

function CloudEnabledMenu({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: 'skip' | 'system' | 'user' }) => void;
}): React.ReactNode {
  const setAppState = useSetAppState();
  const [phase, setPhase] = useState<SyncPhase>('loading');
  const [items, setItems] = useState<FavoriteItemWithStatus[] | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('skill');
  const [orphanedItems, setOrphanedItems] = useState<OrphanedFavoriteItem[]>([]);
  const [syncMessage, setSyncMessage] = useState<string>('');
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
      if (phase === 'confirming') {
        // 在确认对话框中按 Esc 表示保留
        setPhase('ready');
        return;
      }
      onDone('Cancelled', { display: 'system' });
    },
    { context: 'Confirmation' },
  );

  // Load cloud favorites and check for orphaned items
  useEffect(() => {
    let cancelled = false;

    async function loadAndSync() {
      let loadedItems: FavoriteItemWithStatus[] = [];
      try {
        loadedItems = await listFavoriteItems();
      } catch (error: unknown) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        onDone(`Failed to load cloud favorites: ${message}`, { display: 'system' });
        return;
      }

      if (cancelled) return;

      if (loadedItems.length === 0) {
        onDone('No cloud favorites found', { display: 'system' });
        return;
      }

      setItems(loadedItems);
      previousSlugs.current = new Set(
        loadedItems.filter(item => item.status === 'Active').map(item => item.slug),
      );

      setPhase('checking');

      let orphaned: OrphanedFavoriteItem[] = [];
      try {
        orphaned = await findOrphanedFavoriteItems();
      } catch {
        // 如果检测失败，忽略错误继续展示列表
        orphaned = [];
      }

      if (cancelled) return;

      if (orphaned.length === 0) {
        setPhase('ready');
        return;
      }

      setOrphanedItems(orphaned);

      const mode = getHubSyncMode();
      if (mode === 'auto') {
        setPhase('syncing');
        await performSync(orphaned);
      } else {
        setPhase('confirming');
      }
    }

    async function performSync(orphaned: OrphanedFavoriteItem[]) {
      const slugs = orphaned.map(item => item.slug);
      const { unloaded, errors } = await batchUnloadFavoriteItems(slugs);

      if (cancelled) return;

      // Refresh items state after sync
      try {
        const refreshed = await listFavoriteItems();
        if (!cancelled) {
          setItems(refreshed);
          previousSlugs.current = new Set(
            refreshed.filter(item => item.status === 'Active').map(item => item.slug),
          );
        }
      } catch {
        // ignore refresh error
      }

      if (errors.length > 0) {
        setSyncMessage(
          `自动同步完成：卸载 ${unloaded.length} 项，失败 ${errors.length} 项`,
        );
      }

      setPhase('ready');
    }

    void loadAndSync();

    return () => {
      cancelled = true;
    };
  }, [onDone]);

  const handleSyncConfirm = useCallback(async () => {
    setPhase('syncing');
    const slugs = orphanedItems.map(item => item.slug);
    const { unloaded, errors } = await batchUnloadFavoriteItems(slugs);

    // Refresh items state after sync
    try {
      const refreshed = await listFavoriteItems();
      setItems(refreshed);
      previousSlugs.current = new Set(
        refreshed.filter(item => item.status === 'Active').map(item => item.slug),
      );
    } catch {
      // ignore refresh error
    }

    if (errors.length > 0) {
      setSyncMessage(
        `同步完成：卸载 ${unloaded.length} 项，失败 ${errors.length} 项`,
      );
    }
    setPhase('ready');
  }, [orphanedItems]);

  const handleSyncSkip = useCallback(() => {
    setPhase('ready');
  }, []);

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

  if (phase === 'loading') {
    return (
      <Pane color="suggestion">
        <Box marginLeft={1}>
          <Text>Loading cloud favorites...</Text>
        </Box>
      </Pane>
    );
  }

  if (phase === 'checking' || phase === 'syncing') {
    return (
      <Pane color="suggestion">
        <Box marginLeft={1} flexDirection="row" gap={1}>
          <Spinner />
          <Text>{phase === 'checking' ? 'Checking for sync changes...' : 'Syncing local favorites...'}</Text>
        </Box>
      </Pane>
    );
  }

  if (phase === 'confirming') {
    return (
      <SyncConfirmDialog
        orphanedItems={orphanedItems}
        onConfirm={handleSyncConfirm}
        onSkip={handleSyncSkip}
      />
    );
  }

  // phase === 'ready'
  return (
    <Pane color="suggestion">
      {syncMessage && (
        <Box marginLeft={1} marginBottom={1}>
          <Text color="warning">{syncMessage}</Text>
        </Box>
      )}
      <Box marginLeft={1} marginBottom={1}>
        <Text dimColor>
          云端订阅项目，如需订阅请访问 {storeUrl}
        </Text>
      </Box>
      <Tabs title="Hub" selectedTab={activeTab} onTabChange={handleTabChange} color="suggestion">
        {TAB_CONFIG.map(tab => (
          <Tab key={tab.id} id={tab.id} title={tab.title}>
            <TabContent
              items={items?.filter(item => item.itemType === tab.id) ?? []}
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
