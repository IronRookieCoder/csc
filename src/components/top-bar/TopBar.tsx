import * as React from 'react';
import { Box, Text, useTheme, type TextProps } from '@anthropic/ink';
import { getDesignTokens, type DesignTokenColor } from '../../utils/designTokens.js';
import {
  getTerminalGlyphs,
  type TerminalCapabilities,
  type TerminalCharset,
  type TerminalColorDepth,
} from '../../utils/terminalCapabilities.js';
import type { TopBarPipelinePhase, TopBarPipelineStatus, TopBarState } from '../../utils/topBar.js';

type Props = {
  state: TopBarState;
  columns: number;
  charset: TerminalCharset;
  colorDepth?: TerminalColorDepth;
};

type InkTextColor = NonNullable<TextProps['color']>;
type Tokens = ReturnType<typeof getDesignTokens>;

function inkColor(color: DesignTokenColor): InkTextColor {
  return color;
}

function statusColor(status: TopBarPipelineStatus, tokens: Tokens): InkTextColor {
  if (status === 'done') return inkColor(tokens.pipelineDone);
  if (status === 'running') return inkColor(tokens.pipelineRunning);
  if (status === 'attention') return inkColor(tokens.pipelineAttention);
  return inkColor(tokens.pipelinePending);
}

function currentPhase(phases: TopBarPipelinePhase[]): TopBarPipelinePhase {
  return (
    phases.find(phase => phase.status === 'attention') ??
    phases.find(phase => phase.status === 'running') ??
    phases.find(phase => phase.status === 'pending') ??
    phases[phases.length - 1] ?? { id: 'context', title: 'Context', status: 'pending' }
  );
}

function glyphForStatus(status: TopBarPipelineStatus, capabilities: TerminalCapabilities): string {
  const glyphs = getTerminalGlyphs(capabilities);
  if (status === 'done') return glyphs.done;
  if (status === 'running') return glyphs.running;
  if (status === 'attention') return glyphs.attention;
  return glyphs.pending;
}

function PhaseView({
  phase,
  tokens,
  capabilities,
}: {
  phase: TopBarPipelinePhase;
  tokens: Tokens;
  capabilities: TerminalCapabilities;
}): React.ReactNode {
  return (
    <Text wrap="truncate-end">
      <Text color={statusColor(phase.status, tokens)}>{glyphForStatus(phase.status, capabilities)}</Text> {phase.title}
    </Text>
  );
}

export function TopBar({ state, columns, charset, colorDepth = 'truecolor' }: Props): React.ReactNode {
  const [theme] = useTheme();
  const capabilities: TerminalCapabilities = {
    charset,
    colorDepth,
    columns,
    terminalFamily: 'generic',
  };
  const tokens = getDesignTokens(theme, capabilities);
  const glyphs = getTerminalGlyphs(capabilities);
  const mutedColor = inkColor(tokens.muted);

  if (state.mode === 'idle') {
    return (
      <Box width="100%" flexShrink={0} flexDirection="column">
        <Box width="100%" justifyContent="space-between" paddingX={1}>
          <Box gap={2} flexShrink={1}>
            <Text wrap="truncate-end">{state.sessionTitle}</Text>
            {state.layout.kind !== 'minimal' && (
              <Text color={mutedColor} wrap="truncate-end">
                {state.branch}
              </Text>
            )}
          </Box>
          <Text color={mutedColor} wrap="truncate-end">
            {state.brandVersion}
          </Text>
        </Box>
        {state.layout.kind !== 'minimal' && (
          <Box borderBottom borderColor={inkColor(tokens.pipelineConnector)}>
            <Text color={mutedColor} wrap="truncate-end">
              {' '}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  const phases = state.layout.showFullPipeline ? state.pipeline : [currentPhase(state.pipeline)];

  return (
    <Box width="100%" flexShrink={0} flexDirection="column">
      <Box width="100%" justifyContent="space-between" paddingX={1}>
        <Box gap={1} flexShrink={1}>
          {phases.map((phase, index) => (
            <React.Fragment key={phase.id}>
              {index > 0 && <Text color={inkColor(tokens.pipelineConnector)}>{glyphs.connector}</Text>}
              <PhaseView phase={phase} tokens={tokens} capabilities={capabilities} />
            </React.Fragment>
          ))}
        </Box>
        {state.layout.kind !== 'minimal' && (
          <Text color={mutedColor} wrap="truncate-end">
            {state.brandVersion}
          </Text>
        )}
      </Box>
      {state.layout.kind !== 'minimal' && (
        <Box borderBottom borderColor={inkColor(tokens.pipelineConnector)}>
          <Text color={mutedColor} wrap="truncate-end">
            {' '}
          </Text>
        </Box>
      )}
      {state.layout.kind === 'minimal' && (
        <Text color={mutedColor} wrap="truncate-end">
          {state.brandVersion}
        </Text>
      )}
    </Box>
  );
}
