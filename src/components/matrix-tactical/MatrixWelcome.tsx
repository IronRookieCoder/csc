import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { basename } from 'path';
import { formatMatrixDivider, MATRIX_TACTICAL_BANNER_LINES } from '../../utils/matrixTacticalPresentation.js';
import { MatrixMessageLine } from './MatrixMessageLine.js';

type Props = {
  version?: string;
  projectName?: string;
  cwd?: string;
  modelDisplayName?: string;
  billingType?: string;
};

export function MatrixWelcome({
  version = MACRO.VERSION,
  projectName,
  cwd,
  modelDisplayName,
  billingType,
}: Props): React.ReactNode {
  const project = projectName || (cwd ? basename(cwd) : '');
  const providerInfo = billingType && billingType !== 'Not logged in' ? billingType : '';
  const modelLine = [modelDisplayName, providerInfo].filter(Boolean).join(' · ');
  const showModel = !!modelLine;

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
        costrict-cli v{version}
      </MatrixMessageLine>
      {project && (
        <MatrixMessageLine label="SYS" tone="meta">
          project: {project}{cwd ? ` · ${cwd}` : ''}
        </MatrixMessageLine>
      )}
      {showModel && (
        <MatrixMessageLine label="INFO" tone="meta">
          model: {modelLine}
        </MatrixMessageLine>
      )}
      <Text color="inactive">{formatMatrixDivider(60)}</Text>
      <MatrixMessageLine label="LOG" tone="meta">
        Type /help for commands · ? for shortcuts
      </MatrixMessageLine>
    </Box>
  );
}
