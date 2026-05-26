import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import type { ActivityRailState, ActivityStatus } from '../../utils/activityRail.js';
import {
  getTerminalGlyphs,
  type TerminalCapabilities,
  type TerminalCharset,
  type TerminalColorDepth,
} from '../../utils/terminalCapabilities.js';
import type { TopBarPipelinePhase, TopBarPipelineStatus, TopBarState } from '../../utils/topBar.js';
import type { Theme } from '../../utils/theme.js';

type Props = {
  state: ActivityRailState;
  width: number;
  topBarState?: TopBarState;
  charset?: TerminalCharset;
  colorDepth?: TerminalColorDepth;
};

type RailStatus = ActivityStatus | TopBarPipelineStatus;

function statusSymbol(status: RailStatus): string {
  if (status === 'done' || status === 'passed') return '✓';
  if (status === 'running') return '◷';
  if (status === 'attention') return '!';
  if (status === 'pending-review') return '?';
  return '·';
}

function statusColor(status: RailStatus): keyof Theme {
  if (status === 'done' || status === 'passed') return 'success';
  if (status === 'running') return 'warning';
  if (status === 'attention') return 'error';
  if (status === 'pending-review') return 'suggestion';
  return 'subtle';
}

function pipelineStatusSymbol(status: TopBarPipelineStatus, capabilities: TerminalCapabilities): string {
  const glyphs = getTerminalGlyphs(capabilities);
  if (status === 'done') return glyphs.done;
  if (status === 'running') return glyphs.running;
  if (status === 'attention') return glyphs.attention;
  return glyphs.pending;
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactNode {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{title}</Text>
      {children}
    </Box>
  );
}

function ProgressSection({
  state,
  contentWidth,
  capabilities,
}: {
  state: TopBarState;
  contentWidth: number;
  capabilities: TerminalCapabilities;
}): React.ReactNode {
  return (
    <Section title="Progress">
      {state.pipeline.map(phase => (
        <PipelineRow key={phase.id} phase={phase} contentWidth={contentWidth} capabilities={capabilities} />
      ))}
    </Section>
  );
}

function SessionsSection({
  state,
  contentWidth,
}: {
  state: TopBarState;
  contentWidth: number;
}): React.ReactNode {
  return (
    <Section title="Sessions">
      <Box width={contentWidth}>
        <Text wrap="truncate-end">{state.sessionTitle}</Text>
      </Box>
      <Box width={contentWidth}>
        <Text dimColor wrap="truncate-end">
          {state.branch}
        </Text>
      </Box>
    </Section>
  );
}

function PipelineRow({
  phase,
  contentWidth,
  capabilities,
}: {
  phase: TopBarPipelinePhase;
  contentWidth: number;
  capabilities: TerminalCapabilities;
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box width={contentWidth}>
        <Text wrap="truncate-end">
          <Text color={statusColor(phase.status)}>{pipelineStatusSymbol(phase.status, capabilities)}</Text>{' '}
          {phase.title}
        </Text>
      </Box>
      {phase.detail !== undefined && (
        <Box width={contentWidth}>
          <Text dimColor wrap="truncate-end">
            {' '}
            {phase.detail}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function ActivityRail({
  state,
  width,
  topBarState,
  charset = 'unicode',
  colorDepth = 'truecolor',
}: Props): React.ReactNode {
  const contentWidth = Math.max(1, width - 6);
  const capabilities: TerminalCapabilities = {
    charset,
    colorDepth,
    columns: width,
    terminalFamily: 'generic',
  };

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderLeft
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      borderColor="promptBorder"
      paddingX={1}
    >
      {topBarState !== undefined && (
        <>
          <ProgressSection state={topBarState} contentWidth={contentWidth} capabilities={capabilities} />
          <SessionsSection state={topBarState} contentWidth={contentWidth} />
        </>
      )}
      <Section title="Change Set">
        {state.changes.length === 0 ? (
          <Text dimColor>No file changes</Text>
        ) : (
          state.changes.map(item => (
            <Box key={item.filePath}>
              <Text color={statusColor(item.status)}>{statusSymbol(item.status)} </Text>
              <Box width={contentWidth}>
                <Text wrap="truncate-end">{item.filePath}</Text>
              </Box>
              <Box width={contentWidth}>
                <Text dimColor wrap="truncate-end">
                  {' '}
                  {item.diffStat}
                </Text>
              </Box>
            </Box>
          ))
        )}
      </Section>

    </Box>
  );
}
