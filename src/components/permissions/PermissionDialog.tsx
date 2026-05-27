import * as React from 'react';
import { Box, useTheme } from '@anthropic/ink';
import { isMatrixTacticalTheme } from '../../utils/matrixTacticalPresentation.js';
import type { Theme } from '../../utils/theme.js';
import { MatrixPermissionFrame } from '../matrix-tactical/MatrixPermissionFrame.js';
import { PermissionRequestTitle } from './PermissionRequestTitle.js';
import type { WorkerBadgeProps } from './WorkerBadge.js';

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

export function PermissionDialog({
  title,
  subtitle,
  color = 'permission',
  titleColor,
  innerPaddingX = 1,
  workerBadge,
  titleRight,
  children,
}: Props): React.ReactNode {
  const [theme] = useTheme();
  if (isMatrixTacticalTheme(theme)) {
    return (
      <MatrixPermissionFrame
        title={title}
        subtitle={subtitle}
        color={color}
        titleColor={titleColor}
        innerPaddingX={innerPaddingX}
        workerBadge={workerBadge}
        titleRight={titleRight}
      >
        {children}
      </MatrixPermissionFrame>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      borderLeft={false}
      borderRight={false}
      borderBottom={false}
      marginTop={1}
    >
      <Box paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <PermissionRequestTitle title={title} subtitle={subtitle} color={titleColor} workerBadge={workerBadge} />
          {titleRight}
        </Box>
      </Box>
      <Box flexDirection="column" paddingX={innerPaddingX}>
        {children}
      </Box>
    </Box>
  );
}
