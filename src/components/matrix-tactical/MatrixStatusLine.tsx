import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { formatCost } from '../../cost-tracker.js';
import { formatTokens } from '../../utils/format.js';
import { formatCountdown } from '../BuiltinStatusLine.js';

type RateLimitBucket = {
  utilization: number;
  resets_at: number;
};

type Props = {
  modelName: string;
  contextUsedPct: number;
  usedTokens: number;
  contextWindowSize: number;
  totalCostUsd: number;
  cacheText?: string;
  rateLimits: {
    five_hour?: RateLimitBucket;
    seven_day?: RateLimitBucket;
  };
};

export function MatrixStatusLine({
  modelName,
  contextUsedPct,
  usedTokens,
  contextWindowSize,
  totalCostUsd,
  cacheText,
  rateLimits,
}: Props): React.ReactNode {
  const sessionPct = rateLimits.five_hour ? Math.round(rateLimits.five_hour.utilization * 100) : null;
  const weeklyPct = rateLimits.seven_day ? Math.round(rateLimits.seven_day.utilization * 100) : null;
  const sessionReset =
    rateLimits.five_hour && rateLimits.five_hour.resets_at > 0 ? formatCountdown(rateLimits.five_hour.resets_at) : null;
  const weeklyReset =
    rateLimits.seven_day && rateLimits.seven_day.resets_at > 0 ? formatCountdown(rateLimits.seven_day.resets_at) : null;
  const tokenDisplay = `${formatTokens(usedTokens)}/${formatTokens(contextWindowSize)}`;

  return (
    <Box gap={1}>
      <Text color="success">[STAT]</Text>
      <Text>{modelName}</Text>
      <Text color="inactive">| Context </Text>
      <Text>{contextUsedPct}%</Text>
      <Text color="inactive"> ({tokenDisplay})</Text>
      {sessionPct !== null && (
        <>
          <Text color="inactive">| Session </Text>
          <Text>{sessionPct}%</Text>
          {sessionReset && <Text color="inactive"> {sessionReset}</Text>}
        </>
      )}
      {weeklyPct !== null && (
        <>
          <Text color="inactive">| Weekly </Text>
          <Text>{weeklyPct}%</Text>
          {weeklyReset && <Text color="inactive"> {weeklyReset}</Text>}
        </>
      )}
      {totalCostUsd > 0 && (
        <>
          <Text color="inactive">| </Text>
          <Text>{formatCost(totalCostUsd)}</Text>
        </>
      )}
      {cacheText && (
        <>
          <Text color="inactive">| </Text>
          <Text>{cacheText}</Text>
        </>
      )}
    </Box>
  );
}
