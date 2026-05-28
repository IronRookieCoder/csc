import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { MATRIX_TACTICAL_BANNER_LINES } from '../../utils/matrixTacticalPresentation.js';
import { MatrixMessageLine } from './MatrixMessageLine.js';

type Props = {
  version?: string;
};

export function MatrixWelcome({ version = MACRO.VERSION }: Props): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {MATRIX_TACTICAL_BANNER_LINES.map(line => (
          <Text key={line} color="success">
            {line}
          </Text>
        ))}
      </Box>
      <Text> </Text>
      <MatrixMessageLine label="SYS" tone="meta">
        costrict cli version {version}
      </MatrixMessageLine>
      <MatrixMessageLine label="SYS" tone="meta">
        Matrix Tactical terminal theme active
      </MatrixMessageLine>
      <MatrixMessageLine label="OK" tone="success">
        Local context and configuration ready
      </MatrixMessageLine>
      <Text color="inactive">────────────────────────────────────────────────────────────</Text>
      <MatrixMessageLine label="LOG" tone="meta">
        Type "help" or "?" to view available tactical options.
      </MatrixMessageLine>
    </Box>
  );
}
