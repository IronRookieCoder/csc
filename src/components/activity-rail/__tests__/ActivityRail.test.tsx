import { describe, expect, test } from 'bun:test';
import { Box, TerminalSizeContext, Text, useTerminalSize } from '@anthropic/ink';
import * as React from 'react';
import { renderToString } from '../../../utils/staticRender.js';
import { ActivityRail } from '../ActivityRail.js';
import {
  ActivityRailLayout,
  ActivityRailMainColumn,
  getActivityRailChatBackgroundColor,
  getActivityRailChatPaddingTop,
  getActivityRailTopPadding,
  getFullscreenActivityRailAnchorTop,
  hasActivityRailContent,
  shouldAttachActivityRailAnchorRef,
  shouldAttachActivityRailAnchorToMessages,
  shouldAttachActivityRailAnchorToPlaceholder,
  shouldShowFullscreenActivityRail,
} from '../ActivityRailLayout.js';
import {
  getFullscreenMainColumnWidth,
  getFullscreenMainTerminalSize,
  getFullscreenSideRailPaddingTopForAnchor,
  getFullscreenSideRailPaddingTop,
  FullscreenLayout,
} from '../../FullscreenLayout.js';
import type { ActivityRailState } from '../../../utils/activityRail.js';
import type { TopBarState } from '../../../utils/topBar.js';
import { WelcomeCard } from '../../LogoV2/WelcomeCard.js';

const state: ActivityRailState = {
  changes: [{ filePath: 'src/login.ts', diffStat: 'modified', status: 'running' }],
  quality: [
    { id: 'requirements', label: 'Requirements', status: 'pending-review' },
    { id: 'impact', label: 'Impact', status: 'attention' },
    { id: 'verification', label: 'Verification', status: 'pending' },
  ],
};

const topBarState: TopBarState = {
  mode: 'idle',
  sessionTitle: 'Fix login timeout',
  branch: 'docs/csc-ui-redesign',
  brandVersion: 'CoStrict v4.0.13',
  layout: { kind: 'full', showFullPipeline: true, showRail: true, maxWidgets: 8 },
  pipeline: [
    { id: 'context', title: 'Context', status: 'done' },
    { id: 'locate', title: 'Locate', status: 'done' },
    { id: 'edit', title: 'Changes', status: 'running', detail: 'src/login.ts' },
    { id: 'verify', title: 'Verify', status: 'pending' },
  ],
};

function TerminalColumnsProbe(): React.ReactNode {
  const { columns } = useTerminalSize();
  return <Text>child-columns:{columns}</Text>;
}

function HeaderColumnsProbe(): React.ReactNode {
  const { columns } = useTerminalSize();
  return <Text>header-columns:{columns}</Text>;
}

describe('ActivityRail', () => {
  test('renders change set and quality gate', async () => {
    const out = await renderToString(<ActivityRail state={state} width={34} />);

    expect(out).toContain('Change Set');
    expect(out).toContain('src/login.ts');
    expect(out).not.toContain('Quality Gate');
    expect(out).not.toContain('Requirements');
    expect(out).not.toContain('Impact');
    expect(out).not.toContain('Verification');
    expect(out).not.toContain('Activity');
  });

  test('renders idle progress and sessions sections together', async () => {
    const out = await renderToString(<ActivityRail state={state} width={34} topBarState={topBarState} />);

    expect(out).toContain('Progress');
    expect(out).toContain('✓ Context');
    expect(out).toContain('◷ Changes');
    expect(out).toContain('○ Verify');
    expect(out).toContain('Sessions');
    expect(out).toContain('Fix login timeout');
    expect(out).toContain('docs/csc-ui-redesign');
    expect(out).not.toContain('CoStrict v4.0.13');
    expect(out).toContain('Change Set');
  });

  test('renders active progress and sessions sections together', async () => {
    const out = await renderToString(
      <ActivityRail
        state={state}
        width={34}
        topBarState={{ ...topBarState, mode: 'active' }}
        charset="unicode"
      />,
    );

    expect(out).toContain('Progress');
    expect(out).toContain('✓ Context');
    expect(out).toContain('◷ Changes');
    expect(out).toContain('○ Verify');
    expect(out).toContain('src/login.ts');
    expect(out).toContain('Sessions');
    expect(out).toContain('Fix login timeout');
    expect(out).toContain('docs/csc-ui-redesign');
    expect(out).not.toContain('CoStrict v4.0.13');
  });

  test('keeps progress anchored above sessions when both sections render', async () => {
    const out = await renderToString(<ActivityRail state={state} width={34} topBarState={topBarState} />);
    const lines = out.split('\n');
    const progressLine = lines.findIndex(line => line.includes('Progress'));
    const sessionsLine = lines.findIndex(line => line.includes('Sessions'));
    const changeSetLine = lines.findIndex(line => line.includes('Change Set'));

    expect(progressLine).toBeGreaterThanOrEqual(0);
    expect(sessionsLine).toBeGreaterThan(progressLine);
    expect(changeSetLine).toBeGreaterThan(sessionsLine);
  });

  test('hides quality gate while all gates are pending', async () => {
    const out = await renderToString(
      <ActivityRail
        width={34}
        state={{
          changes: [],
          quality: [
            { id: 'requirements', label: 'Requirements', status: 'pending' },
            { id: 'impact', label: 'Impact', status: 'pending' },
            { id: 'verification', label: 'Verification', status: 'pending' },
          ],
        }}
        topBarState={topBarState}
      />,
    );

    expect(out).toContain('Sessions');
    expect(out).not.toContain('Quality Gate');
    expect(out).not.toContain('Requirements');
    expect(out).not.toContain('Impact');
    expect(out).not.toContain('Verification');
  });

  test('renders as a split rail instead of a framed card', async () => {
    const out = await renderToString(<ActivityRail state={state} width={34} />);
    const firstLine = out.split('\n')[0] ?? '';

    expect(firstLine).toContain('│');
    expect(firstLine).not.toContain('╭');
    expect(firstLine).not.toContain('╮');
  });

  test('renders empty state without crashing', async () => {
    const out = await renderToString(
      <ActivityRail
        width={34}
        state={{
          changes: [],
          quality: [],
        }}
      />,
    );

    expect(out).toContain('No file changes');
    expect(out).not.toContain('No gates');
    expect(out).not.toContain('Activity');
  });

  test('truncates long rail text within a narrow width', async () => {
    const out = await renderToString(
      <ActivityRail
        width={34}
        state={{
          changes: [
            {
              filePath: 'src/some/deeply/nested/path/with/a/very/very/very/long/file-name.ts',
              diffStat: 'modified-with-a-very-long-status-description',
              status: 'running',
            },
          ],
          quality: [
            {
              id: 'verification',
              label: 'Verification result needs a very very very very long description',
              status: 'pending',
            },
          ],
        }}
      />,
    );

    expect(out).toContain('Change Set');
    expect(out).not.toContain('Quality Gate');
    expect(out.split('\n').length).toBeLessThanOrEqual(10);
  });
});

describe('ActivityRailLayout', () => {
  const emptyState: ActivityRailState = {
    changes: [],
    quality: [],
  };

  test('applies chat background only when conversation layout is stable', () => {
    expect(
      getActivityRailChatBackgroundColor({
        branch: 'wide-rail',
        theme: 'dark',
        capabilities: {
          charset: 'unicode',
          colorDepth: 'truecolor',
          columns: 140,
          terminalFamily: 'generic',
        },
      }),
    ).toBe('#161b22');

    expect(
      getActivityRailChatBackgroundColor({
        branch: 'narrow-summary',
        theme: 'light',
        capabilities: {
          charset: 'unicode',
          colorDepth: 'truecolor',
          columns: 100,
          terminalFamily: 'generic',
        },
      }),
    ).toBe('#f6efe7');

    expect(
      getActivityRailChatBackgroundColor({
        branch: 'hidden-no-content',
        theme: 'dark',
        capabilities: {
          charset: 'unicode',
          colorDepth: 'truecolor',
          columns: 140,
          terminalFamily: 'generic',
        },
      }),
    ).toBeUndefined();

    expect(
      getActivityRailChatBackgroundColor({
        branch: 'waiting-anchor',
        theme: 'dark',
        capabilities: {
          charset: 'unicode',
          colorDepth: 'truecolor',
          columns: 140,
          terminalFamily: 'generic',
        },
      }),
    ).toBeUndefined();
  });

  test('does not render rail or summary before activity exists', async () => {
    const out = await renderToString(
      <ActivityRailLayout columns={140} railState={emptyState} narrowSummary="Changes: 0 files changed | tests pending">
        <Box flexDirection="column">
          <Text>Welcome screen</Text>
        </Box>
      </ActivityRailLayout>,
      140,
    );

    expect(out).toContain('Welcome screen');
    expect(out).not.toContain('Activity');
    expect(out).not.toContain('Changes: 0 files changed');
  });

  test('renders right rail project information before activity exists when top bar state is provided', async () => {
    const out = await renderToString(
      <ActivityRailLayout
        columns={140}
        railState={emptyState}
        narrowSummary="Changes: 0 files changed | tests pending"
        topBarState={topBarState}
        hasConversationStarted
      >
        <Box flexDirection="column">
          <Text>Welcome screen</Text>
          <Text>Preparing session context</Text>
          <Text>Waiting for first user prompt</Text>
          <Text>Rail should keep session metadata visible</Text>
          <Text>Layout height supports full rail content</Text>
          <Text>Rail can render below progress rows</Text>
          <Text>Sessions title should remain observable</Text>
          <Text>Session branch should remain observable</Text>
          <Text>End of layout fixture</Text>
        </Box>
      </ActivityRailLayout>,
      140,
    );

    expect(out).toContain('Welcome screen');
    expect(out).toContain('Sessions');
    expect(out).toContain('Fix login timeout');
    expect(out).not.toContain('Changes: 0 files changed');
  });

  test('does not render right rail project information before a conversation starts', async () => {
    const out = await renderToString(
      <ActivityRailLayout
        columns={140}
        railState={emptyState}
        narrowSummary="Changes: 0 files changed | tests pending"
        topBarState={topBarState}
      >
        <Box flexDirection="column">
          <Text>Welcome screen</Text>
        </Box>
      </ActivityRailLayout>,
      140,
    );

    expect(out).toContain('Welcome screen');
    expect(out).not.toContain('Sessions');
    expect(out).not.toContain('Fix login timeout');
  });

  test('reports rail content only when changes or non-pending quality gates exist', () => {
    expect(hasActivityRailContent(emptyState)).toBe(false);
    expect(hasActivityRailContent(state)).toBe(true);
    expect(
      hasActivityRailContent({
        changes: [],
        quality: [{ id: 'verification', label: 'Verification', status: 'passed' }],
      }),
    ).toBe(false);
  });

  test('converts measured chat anchor top to rail padding', () => {
    expect(getActivityRailTopPadding(null)).toBe(0);
    expect(getActivityRailTopPadding(0)).toBe(0);
    expect(getActivityRailTopPadding(7)).toBe(7);
  });

  test('does not render wide rail while waiting for the measured anchor in scrollback layout', async () => {
    const anchorRef = React.createRef<import('@anthropic/ink').DOMElement | null>();
    const out = await renderToString(
      <Box flexDirection="column">
        <Text>Dynamic height header</Text>
        <ActivityRailLayout
          columns={140}
          railState={state}
          narrowSummary="Changes: 1 file changed | tests pending"
          anchorRef={anchorRef}
          hasConversationStarted
        >
          <Box flexDirection="column">
            <Box ref={anchorRef} height={0} flexShrink={0} />
            <Text>❯ /re-check</Text>
          </Box>
        </ActivityRailLayout>
      </Box>,
      140,
    );
    const lines = out.split('\n');
    const commandLine = lines.findIndex(line => line.includes('❯ /re-check'));
    const headerLine = lines.findIndex(line => line.includes('Dynamic height header'));

    expect(headerLine).toBeGreaterThanOrEqual(0);
    expect(commandLine).toBeGreaterThanOrEqual(0);
    expect(out).not.toContain('Change Set');
    expect(out).not.toContain('Changes: 1 file changed');
    expect(lines[headerLine]!.length).toBeLessThan(80);
  });

  test('waits for a measured anchor before rendering wide rail when an anchor ref is required', async () => {
    const anchorRef = React.createRef<import('@anthropic/ink').DOMElement | null>();
    const out = await renderToString(
      <ActivityRailLayout
        columns={140}
        railState={state}
        narrowSummary="Changes: 1 file changed | tests pending"
        anchorRef={anchorRef}
        hasConversationStarted
      >
        <Box flexDirection="column">
          <Text>Chat body before anchor mounts</Text>
        </Box>
      </ActivityRailLayout>,
      140,
    );

    expect(out).toContain('Chat body before anchor mounts');
    expect(out).not.toContain('Change Set');
    expect(out).not.toContain('Changes: 1 file changed');
    expect(out.split('\n').some(line => line.includes('│'))).toBe(false);
  });

  test('renders rail beside chat when wide', async () => {
    const out = await renderToString(
      <ActivityRailLayout
        columns={140}
        railState={state}
        narrowSummary="Changes: 1 file changed | tests pending"
        hasConversationStarted
      >
        <Box flexDirection="column">
          <Text>Chat body</Text>
        </Box>
      </ActivityRailLayout>,
      140,
    );

    expect(out).toContain('Chat body');
    expect(out).toContain('Change Set');
    expect(out).not.toContain('Quality Gate');
  });

  test('keeps header width full while scoping reduced width to the main chat column', async () => {
    const out = await renderToString(
      <TerminalSizeContext.Provider value={{ columns: 125, rows: 40 }}>
        <ActivityRailLayout
          columns={125}
          railState={state}
          narrowSummary="Changes: 1 file changed | tests pending"
          hasConversationStarted
        >
          <Box flexDirection="column">
            <HeaderColumnsProbe />
            <ActivityRailMainColumn>
              <TerminalColumnsProbe />
            </ActivityRailMainColumn>
          </Box>
        </ActivityRailLayout>
      </TerminalSizeContext.Provider>,
      125,
    );

    expect(out).toContain('header-columns:125');
    expect(out).toContain('child-columns:91');
    expect(out).toContain('Change Set');
  });

  test('does not clip a full-width welcome header when the wide rail is visible', async () => {
    const out = await renderToString(
      <ActivityRailLayout
        columns={125}
        railState={state}
        narrowSummary="Changes: 1 file changed | tests pending"
        topBarState={topBarState}
        hasConversationStarted
      >
        <Box flexDirection="column">
          <WelcomeCard
            version="4.1.5"
            modelName="Auto With High Effort"
            cwd={'D:\\agent-coding\\csc'}
            columns={125}
          />
          <ActivityRailMainColumn>
            <Text>Chat body</Text>
          </ActivityRailMainColumn>
        </Box>
      </ActivityRailLayout>,
      125,
    );
    const welcomeTopLine = out.split('\n').find(line => line.includes('┌')) ?? '';

    expect(welcomeTopLine.length).toBeGreaterThanOrEqual(120);
    expect(welcomeTopLine).toContain('┐');
    expect(out).toContain('Chat body');
    expect(out).toContain('Change Set');
  });

  test('does not add top padding to the chat column when alignment uses a measured anchor', () => {
    expect(getActivityRailChatPaddingTop(true)).toBe(0);
    expect(getActivityRailChatPaddingTop(false)).toBe(1);
  });

  test('renders summary instead of rail when narrow', async () => {
    const out = await renderToString(
      <ActivityRailLayout
        columns={100}
        railState={state}
        narrowSummary="Changes: 1 file changed | tests pending"
        hasConversationStarted
      >
        <Box flexDirection="column">
          <Text>Chat body</Text>
        </Box>
      </ActivityRailLayout>,
      100,
    );

    expect(out).toContain('Chat body');
    expect(out).toContain('Changes: 1 file changed');
    expect(out).not.toContain('Quality Gate');
  });

  test('keeps the fullscreen right rail aligned to the conversation anchor', () => {
    expect(
      shouldAttachActivityRailAnchorRef({
        hasConversationStarted: true,
        shouldShowRail: true,
      }),
    ).toBe(true);
    expect(
      shouldAttachActivityRailAnchorRef({
        hasConversationStarted: false,
        shouldShowRail: true,
      }),
    ).toBe(false);
    expect(getFullscreenActivityRailAnchorTop(true, 14)).toBe(15);
    expect(getFullscreenActivityRailAnchorTop(true, 14, 1)).toBe(16);
    expect(getFullscreenActivityRailAnchorTop(false, 14)).toBeUndefined();
  });

  test('does not show the fullscreen rail before visible conversation content exists', () => {
    expect(
      shouldShowFullscreenActivityRail({
        fullscreenEnabled: true,
        hasVisibleConversationContent: false,
        shouldShowRail: true,
      }),
    ).toBe(false);
    expect(
      shouldShowFullscreenActivityRail({
        fullscreenEnabled: true,
        hasVisibleConversationContent: true,
        shouldShowRail: true,
      }),
    ).toBe(true);
    expect(
      shouldShowFullscreenActivityRail({
        fullscreenEnabled: false,
        hasVisibleConversationContent: true,
        shouldShowRail: true,
      }),
    ).toBe(false);
  });

  test('anchors fullscreen rail only to visible conversation rows', () => {
    expect(
      shouldAttachActivityRailAnchorToMessages({
        hasVisibleConversationContent: false,
        shouldAttachActivityAnchor: true,
      }),
    ).toBe(false);
    expect(
      shouldAttachActivityRailAnchorToPlaceholder({
        hasVisibleConversationContent: false,
        hasProcessingPlaceholder: true,
        shouldAttachActivityAnchor: true,
      }),
    ).toBe(false);
    expect(
      shouldAttachActivityRailAnchorToPlaceholder({
        hasVisibleConversationContent: true,
        hasProcessingPlaceholder: true,
        shouldAttachActivityAnchor: true,
      }),
    ).toBe(false);
  });
});

describe('FullscreenLayout side rail sizing', () => {
  test('reserves fixed rail width outside the scrollbox', () => {
    expect(getFullscreenMainColumnWidth(140, 34)).toBe(106);
    expect(getFullscreenMainColumnWidth(140)).toBe(140);
    expect(getFullscreenMainColumnWidth(20, 34)).toBe(1);
  });

  test('scopes main terminal size to the scrollbox column width', () => {
    expect(getFullscreenMainTerminalSize(40, 140, 34)).toEqual({ rows: 40, columns: 106 });
    expect(getFullscreenMainTerminalSize(40, 140)).toEqual({ rows: 40, columns: 140 });
  });

  test('main column width remains scoped when a fixed top bar is present', () => {
    expect(getFullscreenMainTerminalSize(40, 140, 34)).toEqual({ rows: 40, columns: 106 });
    expect(getFullscreenMainColumnWidth(100, 34)).toBe(66);
  });

  test('keeps the legacy fallback for side rail top padding', () => {
    expect(getFullscreenSideRailPaddingTop(false)).toBe(8);
    expect(getFullscreenSideRailPaddingTop(true)).toBe(0);
  });

  test('aligns the side rail from a measured conversation anchor', () => {
    expect(getFullscreenSideRailPaddingTopForAnchor(false, 12)).toBe(12);
    expect(getFullscreenSideRailPaddingTopForAnchor(false, null)).toBe(8);
    expect(getFullscreenSideRailPaddingTopForAnchor(true, 12)).toBe(0);
  });

  test('keeps fullscreen side rail out of the bottom input area', async () => {
    const originalUserType = process.env.USER_TYPE;
    process.env.USER_TYPE = 'ant';
    try {
      const out = await renderToString(
        <FullscreenLayout
          scrollable={
            <Box flexDirection="column">
              <Text>Chat row</Text>
              <Text>More chat</Text>
            </Box>
          }
          bottom={
            <Box flexDirection="column">
              <Text>INPUT ROW</Text>
              <Text>WIDGET ROW</Text>
            </Box>
          }
          sideRail={
            <Box flexDirection="column">
              <Text>Rail top</Text>
              <Text>Rail middle</Text>
              <Text>Rail lower</Text>
              <Text>Rail near input</Text>
              <Text>Rail should not reach input</Text>
            </Box>
          }
          sideRailWidth={34}
          sideRailAnchorTop={0}
        />,
        100,
      );
      const inputLine = out.split('\n').find(line => line.includes('INPUT ROW')) ?? '';
      const widgetLine = out.split('\n').find(line => line.includes('WIDGET ROW')) ?? '';

      expect(inputLine).toContain('INPUT ROW');
      expect(widgetLine).toContain('WIDGET ROW');
      expect(out).toContain('Rail should not reach input');
      expect(inputLine).not.toContain('Rail');
      expect(widgetLine).not.toContain('Rail');
    } finally {
      if (originalUserType === undefined) {
        delete process.env.USER_TYPE;
      } else {
        process.env.USER_TYPE = originalUserType;
      }
    }
  });
});
