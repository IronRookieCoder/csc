import React from 'react';
import { Text } from '@anthropic/ink';
import {
  formatMatrixPrefix,
  MATRIX_TACTICAL_TONE_TO_THEME_KEY,
} from '../../utils/matrixTacticalPresentation.js';

export function MatrixPromptCursor(): React.ReactNode {
  return <Text color="success">[costrict] &gt;&gt; </Text>;
}

type HintProps = {
  children: React.ReactNode;
};

export function MatrixFooterHint({ children }: HintProps): React.ReactNode {
  return (
    // Footer hints are embedded inside Text/Byline, so this is intentionally inline.
    <Text color={MATRIX_TACTICAL_TONE_TO_THEME_KEY.meta}>
      {formatMatrixPrefix('CUE')} {children}
    </Text>
  );
}
