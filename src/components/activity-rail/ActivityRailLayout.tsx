import * as React from 'react';
import { Box, type DOMElement, TerminalSizeContext, Text, useTerminalSize } from '@anthropic/ink';
import { ActivityRail } from './ActivityRail.js';
import { logForDebugging } from '../../utils/debug.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import type { ActivityRailState } from '../../utils/activityRail.js';
import type { TerminalCharset, TerminalColorDepth } from '../../utils/terminalCapabilities.js';
import type { TopBarState } from '../../utils/topBar.js';

export const ACTIVITY_RAIL_MIN_COLUMNS = 120;
export const ACTIVITY_RAIL_WIDTH = 34;

export function shouldShowActivityRail(columns: number): boolean {
  return columns >= ACTIVITY_RAIL_MIN_COLUMNS;
}

export function hasActivityRailContent(railState: ActivityRailState): boolean {
  return railState.changes.length > 0;
}

function hasRailContent(
  railState: ActivityRailState,
  topBarState: TopBarState | undefined,
  hasConversationStarted: boolean,
): boolean {
  return hasConversationStarted && (topBarState !== undefined || hasActivityRailContent(railState));
}

export function getActivityRailTopPadding(anchorTop: number | null): number {
  if (anchorTop === null) return 0;
  return Math.max(0, anchorTop);
}

export function getActivityRailChatPaddingTop(hasAnchorRef: boolean): number {
  return hasAnchorRef ? 0 : 1;
}

export function getElementAbsoluteTop(element: DOMElement | null): number | null {
  if (!element?.yogaNode) return null;

  let top = element.yogaNode.getComputedTop();
  let parent = element.parentNode;
  while (parent) {
    if (parent.yogaNode) {
      top += parent.yogaNode.getComputedTop();
    }
    parent = parent.parentNode;
  }
  return top;
}

export function shouldAttachActivityRailAnchorRef({
  hasConversationStarted,
  shouldShowRail,
}: {
  hasConversationStarted: boolean;
  shouldShowRail: boolean;
}): boolean {
  return hasConversationStarted && shouldShowRail;
}

export function shouldShowFullscreenActivityRail({
  fullscreenEnabled,
  hasVisibleConversationContent,
  shouldShowRail,
}: {
  fullscreenEnabled: boolean;
  hasVisibleConversationContent: boolean;
  shouldShowRail: boolean;
}): boolean {
  return fullscreenEnabled && hasVisibleConversationContent && shouldShowRail;
}

export function shouldAttachActivityRailAnchorToMessages({
  hasVisibleConversationContent,
  shouldAttachActivityAnchor,
}: {
  hasVisibleConversationContent: boolean;
  shouldAttachActivityAnchor: boolean;
}): boolean {
  return shouldAttachActivityAnchor && hasVisibleConversationContent;
}

export function shouldAttachActivityRailAnchorToPlaceholder({
  hasVisibleConversationContent,
  hasProcessingPlaceholder,
  shouldAttachActivityAnchor,
}: {
  hasVisibleConversationContent: boolean;
  hasProcessingPlaceholder: boolean;
  shouldAttachActivityAnchor: boolean;
}): boolean {
  void hasVisibleConversationContent;
  void hasProcessingPlaceholder;
  void shouldAttachActivityAnchor;
  return false;
}

export function getFullscreenActivityRailAnchorTop(
  showFullscreenActivityRail: boolean,
  anchorTop: number | null,
  visibleRowOffset = 0,
): number | undefined {
  if (!showFullscreenActivityRail || anchorTop === null) return undefined;
  return anchorTop + 1 + visibleRowOffset;
}

export function useElementAbsoluteTop(ref: React.RefObject<DOMElement | null> | undefined): number | null {
  const [top, setTop] = React.useState<number | null>(null);
  const pendingTopRef = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    if (!ref) {
      pendingTopRef.current = null;
      setTop(null);
      return;
    }
    const nextTop = getElementAbsoluteTop(ref.current);
    const measuredTop = Number.isFinite(nextTop) ? nextTop! : null;
    if (measuredTop === null) {
      pendingTopRef.current = null;
      setTop(null);
      return;
    }
    if (pendingTopRef.current !== measuredTop) {
      pendingTopRef.current = measuredTop;
      return;
    }
    setTop(currentTop => (currentTop === measuredTop ? currentTop : measuredTop));
  });

  return top;
}

function useActivityRailLayoutDebugLog({
  branch,
  columns,
  chatWidth,
  chatPaddingTop,
  anchorTop,
  railPaddingTop,
  hasConversationStarted,
  hasTopBarState,
  hasRailStateContent,
}: {
  branch: string;
  columns: number;
  chatWidth?: number;
  chatPaddingTop?: number;
  anchorTop: number | null;
  railPaddingTop?: number;
  hasConversationStarted: boolean;
  hasTopBarState: boolean;
  hasRailStateContent: boolean;
}): void {
  const lastLogRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isEnvTruthy(process.env.COSTRICT_DEBUG_ACTIVITY_RAIL)) return;
    const message =
      `[activity-rail:layout] branch=${branch} columns=${columns} chatWidth=${chatWidth ?? 'none'} chatPaddingTop=${chatPaddingTop ?? 'none'} anchorTop=${anchorTop ?? 'none'} railPaddingTop=${railPaddingTop ?? 'none'} hasConversationStarted=${hasConversationStarted} topBar=${hasTopBarState} railContent=${hasRailStateContent}`;
    if (lastLogRef.current === message) return;
    lastLogRef.current = message;
    logForDebugging(message);
  }, [
    branch,
    columns,
    chatWidth,
    chatPaddingTop,
    anchorTop,
    railPaddingTop,
    hasConversationStarted,
    hasTopBarState,
    hasRailStateContent,
  ]);
}

type Props = {
  columns: number;
  railState: ActivityRailState;
  narrowSummary: string;
  topBarState?: TopBarState;
  hasConversationStarted?: boolean;
  charset?: TerminalCharset;
  colorDepth?: TerminalColorDepth;
  anchorRef?: React.RefObject<DOMElement | null>;
  children: React.ReactNode;
};

type ActivityRailMainColumnProps = {
  children: React.ReactNode;
};

const ActivityRailMainColumnContext = React.createContext<number | null>(null);

export function ActivityRailMainColumn({ children }: ActivityRailMainColumnProps): React.ReactNode {
  const terminalSize = useTerminalSize();
  const chatWidth = React.useContext(ActivityRailMainColumnContext);

  if (chatWidth === null) {
    return <>{children}</>;
  }

  return (
    <TerminalSizeContext.Provider value={{ ...terminalSize, columns: chatWidth }}>
      <>{children}</>
    </TerminalSizeContext.Provider>
  );
}

export function ActivityRailLayout({
  columns,
  railState,
  narrowSummary,
  topBarState,
  hasConversationStarted = false,
  charset,
  colorDepth,
  anchorRef,
  children,
}: Props): React.ReactNode {
  const terminalSize = useTerminalSize();
  const anchorTop = useElementAbsoluteTop(anchorRef);
  const hasRailStateContent = hasActivityRailContent(railState);
  const hasTopBarState = topBarState !== undefined;
  const hasContent = hasRailContent(railState, topBarState, hasConversationStarted);
  const isWide = shouldShowActivityRail(columns);
  const chatWidth = Math.max(1, columns - ACTIVITY_RAIL_WIDTH);
  const chatPaddingTop = getActivityRailChatPaddingTop(anchorRef !== undefined);
  const branch = !hasContent
    ? 'hidden-no-content'
    : !isWide
      ? 'narrow-summary'
      : anchorRef !== undefined && anchorTop === null
        ? 'waiting-anchor'
        : 'wide-rail';
  const railPaddingTop = branch === 'wide-rail' ? getActivityRailTopPadding(anchorTop) : undefined;

  useActivityRailLayoutDebugLog({
    branch,
    columns,
    chatWidth: branch === 'waiting-anchor' ? columns : branch === 'wide-rail' ? chatWidth : undefined,
    chatPaddingTop: branch === 'wide-rail' ? chatPaddingTop : undefined,
    anchorTop,
    railPaddingTop,
    hasConversationStarted,
    hasTopBarState,
    hasRailStateContent,
  });

  if (!hasContent) {
    return <Box flexDirection="column">{children}</Box>;
  }

  if (!isWide) {
    return (
      <Box flexDirection="column">
        {children}
        <Text wrap="truncate-end">{narrowSummary}</Text>
      </Box>
    );
  }

  if (anchorRef !== undefined && anchorTop === null) {
    return <Box flexDirection="column">{children}</Box>;
  }

  return (
    <Box flexDirection="column" width={columns} position="relative">
      <ActivityRailMainColumnContext.Provider value={chatWidth}>
        <Box flexDirection="column" width={columns} paddingTop={chatPaddingTop}>
          {children}
        </Box>
      </ActivityRailMainColumnContext.Provider>
      <Box
        flexDirection="column"
        width={ACTIVITY_RAIL_WIDTH}
        position="absolute"
        top={railPaddingTop ?? 0}
        right={0}
      >
        <ActivityRail
          state={railState}
          width={ACTIVITY_RAIL_WIDTH}
          topBarState={topBarState}
          charset={charset}
          colorDepth={colorDepth}
        />
      </Box>
    </Box>
  );
}
