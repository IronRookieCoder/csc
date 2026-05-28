import React from 'react';
import { Box, Text } from '@anthropic/ink';
import type { Theme } from '../../utils/theme.js';
import {
  formatMatrixPrefix,
  MATRIX_TACTICAL_TONE_TO_THEME_KEY,
  type MatrixTone,
} from '../../utils/matrixTacticalPresentation.js';

type Props = {
  label: string;
  tone?: MatrixTone;
  children: React.ReactNode;
  /** 左边框颜色主题 key，用于错误/工具块等场景 */
  leftBorderColor?: keyof Theme;
};

const TONE_TO_TEXT_COLOR: Record<MatrixTone, keyof Theme> = {
  primary: 'text',
  success: 'success',
  warning: 'warning',
  permission: 'warning',
  error: 'error',
  meta: 'inactive',
  input: 'text',
};

export function MatrixMessageLine({ label, tone = 'meta', children, leftBorderColor }: Props): React.ReactNode {
  const prefixColor = MATRIX_TACTICAL_TONE_TO_THEME_KEY[tone];
  const textColor = TONE_TO_TEXT_COLOR[tone];

  const content = (
    <Box>
      <Text color={prefixColor}>{formatMatrixPrefix(label)} </Text>
      <Text color={textColor}>{children}</Text>
    </Box>
  );

  if (leftBorderColor) {
    return (
      <Box
        borderStyle="single"
        borderLeft
        borderTop={false}
        borderBottom={false}
        borderRight={false}
        borderColor={leftBorderColor}
        paddingLeft={1}
      >
        {content}
      </Box>
    );
  }

  return content;
}
