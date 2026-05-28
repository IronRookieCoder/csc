import * as React from 'react';
import { Box, Text, useTheme } from '@anthropic/ink';
import { getTheme, type Theme } from '../../utils/theme.js';
import { isMatrixTacticalTheme } from '../../utils/matrixTacticalPresentation.js';
import { getDefaultCharacters } from './utils.js';
import { getStalledSpinnerColor } from './stalledColor.js';

const DEFAULT_CHARACTERS = getDefaultCharacters();

export const TRIANGLE_FRAMES = ['◢', '◣', '◤', '◥'];

const SPINNER_FRAMES = [...DEFAULT_CHARACTERS, ...[...DEFAULT_CHARACTERS].reverse()];

const REDUCED_MOTION_DOT = '●';
const REDUCED_MOTION_CYCLE_MS = 2000; // 2-second cycle: 1s visible, 1s dim

type Props = {
  frame: number;
  messageColor: keyof Theme;
  stalledIntensity?: number;
  reducedMotion?: boolean;
  time?: number;
};

export function SpinnerGlyph({
  frame,
  messageColor,
  stalledIntensity = 0,
  reducedMotion = false,
  time = 0,
}: Props): React.ReactNode {
  const [themeName] = useTheme();
  const theme = getTheme(themeName);

  // Reduced motion: slowly flashing orange dot
  if (reducedMotion) {
    const isDim = Math.floor(time / (REDUCED_MOTION_CYCLE_MS / 2)) % 2 === 1;
    return (
      <Box flexWrap="wrap" height={1} width={2}>
        <Text color={messageColor} dimColor={isDim}>
          {REDUCED_MOTION_DOT}
        </Text>
      </Box>
    );
  }

  const isMatrix = isMatrixTacticalTheme(themeName);
  const frames = isMatrix ? TRIANGLE_FRAMES : SPINNER_FRAMES;
  const spinnerChar = frames[frame % frames.length];

  // Resolve the theme-specific stalled color.
  if (stalledIntensity > 0) {
    const color = getStalledSpinnerColor({
      themeName,
      theme,
      messageColor,
      stalledIntensity,
    });
    return (
      <Box flexWrap="wrap" height={1} width={2}>
        <Text color={color}>{spinnerChar}</Text>
      </Box>
    );
  }

  return (
    <Box flexWrap="wrap" height={1} width={2}>
      <Text color={messageColor}>{spinnerChar}</Text>
    </Box>
  );
}
