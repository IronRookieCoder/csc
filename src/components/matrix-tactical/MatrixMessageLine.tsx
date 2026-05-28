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
  const color = MATRIX_TACTICAL_TONE_TO_THEME_KEY[tone];
  return (
    <Box>
      <Text color={color}>{formatMatrixPrefix(label)} </Text>
      <Text color={tone === 'input' ? 'text' : color}>{children}</Text>
    </Box>
  );
}
