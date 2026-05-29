import React, { useEffect, useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { formatCost } from '../../cost-tracker.js';
import { formatTokens } from '../../utils/format.js';
import type { EffortLevel } from '../../utils/effort.js';
import { matrixActionPrefix } from '../../utils/matrixTacticalPresentation.js';
import { getModeColor, permissionModeTitle, type PermissionMode } from '../../utils/permissions/PermissionMode.js';
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
  cacheText?: React.ReactNode;
  permissionMode?: PermissionMode;
  effortLevel?: EffortLevel;
  memoryText?: string;
  runText?: string;
  cueText?: string;
  extraItems?: React.ReactNode[];
  rateLimits: {
    five_hour?: RateLimitBucket;
    seven_day?: RateLimitBucket;
  };
};

function colorForExtraItem(item: React.ReactNode): string | undefined {
  if (typeof item !== 'string') return undefined;
  return /\blast\s+exit\s+[1-9]\d*\b/i.test(item) ? 'error' : undefined;
}

export function MatrixStatusLine({ rateLimits, ...props }: Props): React.ReactNode {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const hasResetTime = (rateLimits.five_hour?.resets_at ?? 0) || (rateLimits.seven_day?.resets_at ?? 0);
    if (!hasResetTime) return;
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, [rateLimits.five_hour?.resets_at, rateLimits.seven_day?.resets_at]);
  void tick;

  return <MatrixStatusLineContent {...props} rateLimits={rateLimits} />;
}

export function MatrixStatusLineContent({
  modelName,
  contextUsedPct,
  usedTokens,
  contextWindowSize,
  totalCostUsd,
  cacheText,
  permissionMode,
  effortLevel,
  memoryText,
  runText,
  cueText,
  extraItems = [],
  rateLimits,
}: Props): React.ReactNode {
  const visibleExtraItems = extraItems.filter(item => item !== null && item !== undefined && item !== false);
  const sessionPct = rateLimits.five_hour ? Math.round(rateLimits.five_hour.utilization * 100) : null;
  const weeklyPct = rateLimits.seven_day ? Math.round(rateLimits.seven_day.utilization * 100) : null;
  const sessionReset =
    rateLimits.five_hour && rateLimits.five_hour.resets_at > 0 ? formatCountdown(rateLimits.five_hour.resets_at) : null;
  const weeklyReset =
    rateLimits.seven_day && rateLimits.seven_day.resets_at > 0 ? formatCountdown(rateLimits.seven_day.resets_at) : null;
  const tokenDisplay = `${formatTokens(usedTokens)}/${formatTokens(contextWindowSize)}`;

  return (
    <Box
      width="100%"
      gap={1}
      flexWrap="wrap"
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor="rate_limit_empty"
      marginTop={3}
    >
      <Box gap={1} flexWrap="wrap" width="100%">
        <Text color="ansi:cyan">[STAT]</Text>
        <Text color="text">{modelName}</Text>
        <Text color="inactive">| </Text>
        <Text color="remember">Context {contextUsedPct}%</Text>
        <Text color="inactive"> ({tokenDisplay})</Text>
        {sessionPct !== null && (
          <>
            <Text color="inactive">| </Text>
            <Text color="warning">Session {sessionPct}%</Text>
            {sessionReset && <Text color="inactive"> {sessionReset}</Text>}
          </>
        )}
        {weeklyPct !== null && (
          <>
            <Text color="inactive">| </Text>
            <Text color="ansi:magenta">Weekly {weeklyPct}%</Text>
            {weeklyReset && <Text color="inactive"> {weeklyReset}</Text>}
          </>
        )}
        {totalCostUsd > 0 && (
          <>
            <Text color="inactive">| </Text>
            <Text color="success">{formatCost(totalCostUsd)}</Text>
          </>
        )}
        {cacheText ? (
          <>
            <Text color="inactive">| </Text>
            {typeof cacheText === 'string' ? <Text color="ansi:magenta">{cacheText}</Text> : cacheText}
          </>
        ) : null}
        {permissionMode ? (
          <>
            <Text color="inactive">| </Text>
            <Text color={getModeColor(permissionMode)}>{permissionModeTitle(permissionMode).toLowerCase()} on</Text>
          </>
        ) : null}
        {effortLevel ? (
          <>
            <Text color="inactive">| Effort </Text>
            <Text>{effortLevel}</Text>
          </>
        ) : null}
        {memoryText ? (
          <>
            <Text color="inactive">| </Text>
            <Text dimColor>{memoryText}</Text>
          </>
        ) : null}
        {runText ? (
          <>
            <Text color="inactive">| </Text>
            <Text color="warning">{matrixActionPrefix('run')}</Text>
            <Text>{runText}</Text>
          </>
        ) : null}
        {cueText ? (
          <>
            <Text color="inactive">| </Text>
            <Text color="inactive">{matrixActionPrefix('cue')}</Text>
            <Text dimColor>{cueText}</Text>
          </>
        ) : null}
        {visibleExtraItems.map((item, index) => (
          <React.Fragment key={index}>
            <Text color="inactive">| </Text>
            {typeof item === 'string' ? <Text color={colorForExtraItem(item)}>{item}</Text> : item}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}
