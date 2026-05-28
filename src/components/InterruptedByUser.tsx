import * as React from 'react';
import { Text, useTheme } from '@anthropic/ink';
import { isMatrixTacticalTheme, matrixActionPrefix } from '../utils/matrixTacticalPresentation.js';

export function InterruptedByUser(): React.ReactNode {
  const [theme] = useTheme();
  const isMatrix = isMatrixTacticalTheme(theme);
  return (
    <>
      {isMatrix && <Text color="warning">{matrixActionPrefix('abort')} </Text>}
      <Text dimColor>Interrupted </Text>
      {process.env.USER_TYPE === 'ant' ? (
        <Text dimColor>· [ANT-ONLY] /issue to report a model issue</Text>
      ) : (
        <Text dimColor>· What should Claude do instead?</Text>
      )}
    </>
  );
}
