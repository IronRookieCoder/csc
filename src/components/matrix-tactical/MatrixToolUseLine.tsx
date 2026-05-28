import React from 'react';
import { Box, Text } from '@anthropic/ink';
import type { Theme } from '../../utils/theme.js';
import { formatMatrixProgress, matrixToolPrefixForName, matrixToolColorForName } from '../../utils/matrixTacticalPresentation.js';
import { MatrixMessageLine } from './MatrixMessageLine.js';

type MatrixToolState = 'queued' | 'working' | 'success' | 'error';

type Props = {
  name: string;
  detail?: React.ReactNode;
  tag?: React.ReactNode;
  state: MatrixToolState;
  progressPercent?: number;
};

function toneForState(state: MatrixToolState): 'meta' | 'warning' | 'success' | 'error' {
  switch (state) {
    case 'queued':
      return 'meta';
    case 'working':
      return 'warning';
    case 'success':
      return 'success';
    case 'error':
      return 'error';
  }
}

export function MatrixToolUseLine({ name, detail, tag, state, progressPercent }: Props): React.ReactNode {
  const toolColor = matrixToolColorForName(name);

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="row"
        flexWrap="wrap"
        borderStyle="single"
        borderLeft
        borderTop={false}
        borderBottom={false}
        borderRight={false}
        borderColor={toolColor as keyof Theme}
      >
        <Box paddingLeft={1}>
          <MatrixMessageLine label={matrixToolPrefixForName(name, state)} tone={toneForState(state)}>
            {name}
            {detail ? <Text color="text"> ({detail})</Text> : null}
          </MatrixMessageLine>
        </Box>
        {tag}
      </Box>
      {progressPercent !== undefined && (
        <Box paddingLeft={3}>
          <Text color="success">[PROGRESS] {formatMatrixProgress(progressPercent)}</Text>
        </Box>
      )}
    </Box>
  );
}
