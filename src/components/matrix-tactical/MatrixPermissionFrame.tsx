import React from 'react';
import { Box, Text } from '@anthropic/ink';
import type { Theme } from '../../utils/theme.js';
import type { WorkerBadgeProps } from '../permissions/WorkerBadge.js';
import { PermissionRequestTitle } from '../permissions/PermissionRequestTitle.js';
import { formatMatrixDivider, matrixActionPrefix } from '../../utils/matrixTacticalPresentation.js';
import { MatrixMessageLine } from './MatrixMessageLine.js';

type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  titleColor?: keyof Theme;
  innerPaddingX?: number;
  workerBadge?: WorkerBadgeProps;
  titleRight?: React.ReactNode;
  children: React.ReactNode;
};

export function MatrixPermissionFrame({
  title,
  subtitle,
  color,
  titleColor,
  innerPaddingX = 1,
  workerBadge,
  titleRight,
  children,
}: Props): React.ReactNode {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="warning">
        ==================== {matrixActionPrefix('req')} 权 限 提 审 {matrixActionPrefix('req')} {formatMatrixDivider(18)}
      </Text>
      <Box paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <PermissionRequestTitle title={title} subtitle={subtitle} color={titleColor ?? color ?? 'warning'} workerBadge={workerBadge} />
          {titleRight}
        </Box>
      </Box>
      <Box flexDirection="column" paddingX={innerPaddingX}>
        <MatrixMessageLine label="REQ" tone="permission">
          Review the requested local action before continuing.
        </MatrixMessageLine>
        {children}
        <MatrixMessageLine label="CUE" tone="meta">
          Choose an approval option to continue.
        </MatrixMessageLine>
      </Box>
      <Text color="inactive">{formatMatrixDivider(64)}</Text>
    </Box>
  );
}
