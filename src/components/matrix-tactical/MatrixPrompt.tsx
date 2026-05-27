import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { MatrixMessageLine } from './MatrixMessageLine.js';

export function MatrixPromptCursor(): React.ReactNode {
  return (
    <Box>
      <Text color="success">[costrict] &gt;&gt;</Text>
    </Box>
  );
}

type HintProps = {
  children: React.ReactNode;
};

export function MatrixFooterHint({ children }: HintProps): React.ReactNode {
  return (
    <MatrixMessageLine label="CUE" tone="meta">
      {children}
    </MatrixMessageLine>
  );
}
