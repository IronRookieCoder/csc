import React from 'react';
import { Box, Text } from '@anthropic/ink';
import {
  formatMatrixPrefix,
  MATRIX_TACTICAL_TONE_TO_THEME_KEY,
  type MatrixTone,
} from '../../utils/matrixTacticalPresentation.js';

type Props = {
  label: string;
  tone?: MatrixTone;
  children: React.ReactNode;
};

export function MatrixMessageLine({ label, tone = 'meta', children }: Props): React.ReactNode {
  return (
    <Box>
      <Text color={MATRIX_TACTICAL_TONE_TO_THEME_KEY[tone]}>{formatMatrixPrefix(label)} </Text>
      <Text color={tone === 'input' ? 'text' : MATRIX_TACTICAL_TONE_TO_THEME_KEY[tone]}>{children}</Text>
    </Box>
  );
}
