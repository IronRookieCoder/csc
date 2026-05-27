import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { formatMatrixProgress } from '../../utils/matrixTacticalPresentation.js';
import { MatrixMessageLine } from './MatrixMessageLine.js';

type MatrixToolState = 'queued' | 'working' | 'success' | 'error';

type Props = {
  name: string;
  detail?: React.ReactNode;
  state: MatrixToolState;
  progressPercent?: number;
};

function labelForState(state: MatrixToolState): string {
  switch (state) {
    case 'queued':
      return 'RUN';
    case 'working':
      return 'RUN';
    case 'success':
      return 'OK';
    case 'error':
      return 'ERR';
  }
}

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

export function MatrixToolUseLine({ name, detail, state, progressPercent }: Props): React.ReactNode {
  return (
    <Box flexDirection="column">
      <MatrixMessageLine label={labelForState(state)} tone={toneForState(state)}>
        {name}
        {detail ? <Text color="text"> ({detail})</Text> : null}
      </MatrixMessageLine>
      {progressPercent !== undefined && (
        <Box paddingLeft={3}>
          <Text color="success">[PROGRESS] {formatMatrixProgress(progressPercent)}</Text>
        </Box>
      )}
    </Box>
  );
}
