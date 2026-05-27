import React from 'react';
import { Box, Text } from '@anthropic/ink';
import {
  formatMatrixPrefix,
  MATRIX_TACTICAL_TONE_TO_THEME_KEY,
} from '../../utils/matrixTacticalPresentation.js';

export function MatrixPromptCursor(): React.ReactNode {
  return (
    <Box>
      <Text color="success">[costrict] &gt;&gt;</Text>
    </Box>
  );
}

type HintProps = {
  children: string | number;
};

export function MatrixFooterHint({ children }: HintProps): React.ReactNode {
  return (
    // Footer hints are embedded inside Text/Byline, so this is intentionally inline.
    <Text color={MATRIX_TACTICAL_TONE_TO_THEME_KEY.meta}>
      {formatMatrixPrefix('CUE')} {children}
    </Text>
  );
}
