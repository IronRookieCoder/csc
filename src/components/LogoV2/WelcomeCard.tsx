import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { truncate } from '../../utils/format.js';
import { compactModelName } from '../../utils/widgetBar.js';

type Props = {
  version: string;
  modelName: string;
  cwd: string;
  columns: number;
  branch?: string | null;
};

const STARTER_COMMANDS = [
  '/strict:plan — structured proposal & execution',
  '/strict-test — comprehensive testing workflow',
  '/strict-project-wiki — project knowledge base',
] as const;

const LARGE_WORDMARK_LINES = [
  '█▀▀ █▀█ █▀▀ ▀█▀ █▀█ █ █▀▀ ▀█▀',
  '█   █ █ ▀▀█  █  █▀▄ █ █    █ ',
  '▀▀▀ ▀▀▀ ▀▀▀  ▀  ▀ ▀ ▀ ▀▀▀  ▀ ',
] as const;

function titleModelToken(token: string): string {
  if (/^v\d+$/i.test(token)) return token.toUpperCase();
  return token.length === 0
    ? token
    : `${token[0]?.toUpperCase()}${token.slice(1).toLowerCase()}`;
}

function formatWelcomeModelName(modelName: string): string {
  const compactName = compactModelName(modelName);
  if (compactName !== modelName) return compactName;

  const contextSuffixes: string[] = [];
  const withoutContextSuffix = modelName
    .trim()
    .replace(/\[(\d+)m\]/gi, (_match, size: string) => {
      contextSuffixes.push(`${size}M`);
      return '';
    });
  const providerTrimmed = withoutContextSuffix.replace(
    /^(vendor|costrict|claude|anthropic)[/_-]+/i,
    '',
  );
  const tokens = providerTrimmed.split(/[^a-z0-9]+/i).filter(Boolean);
  if (tokens.length === 0) return modelName;

  return [...tokens.map(titleModelToken), ...contextSuffixes].join(' ');
}

function getProjectName(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/, '');
  const projectName = normalized.split(/[\\/]/).at(-1) ?? '';
  return projectName.length > 0 ? projectName : cwd;
}

export function WelcomeCard({
  version,
  modelName,
  cwd,
  columns,
  branch,
}: Props): React.ReactNode {
  const width = Math.min(Math.max(columns, 44), 132);
  const isHorizontal = width >= 72;
  const useLargeWordmark = width >= 110;
  const innerWidth = width - 4;
  const brandWidth = isHorizontal
    ? useLargeWordmark
      ? Math.min(50, Math.max(44, Math.floor(innerWidth * 0.39)))
      : Math.min(36, Math.max(26, Math.floor(innerWidth * 0.36)))
    : innerWidth;
  const contentWidth = isHorizontal
    ? Math.max(innerWidth - brandWidth - 3, 32)
    : innerWidth;
  const valueWidth = Math.max(contentWidth - 10, 12);
  const modelLabel = `${formatWelcomeModelName(modelName)} · Ready`;
  const projectName = getProjectName(cwd);
  const branchLabel = branch?.trim() ? branch : 'no branch';

  const metaRows = [
    ['Project', projectName],
    ['Branch', branchLabel],
    ['Path', cwd],
  ] as const;

  const brandPanel = (
    <Box
      width={brandWidth}
      minHeight={useLargeWordmark ? 11 : isHorizontal ? 11 : 3}
      flexDirection="column"
      alignItems="center"
      justifyContent={isHorizontal ? 'center' : 'flex-start'}
      paddingX={1}
    >
      {useLargeWordmark ? (
        <>
          {LARGE_WORDMARK_LINES.map(line => (
            <Text key={line} color="claudeBlue_FOR_SYSTEM_SPINNER" bold>
              {line}
            </Text>
          ))}
        </>
      ) : isHorizontal ? (
        <Box flexDirection="column" alignItems="center">
          <Text color="claudeBlue_FOR_SYSTEM_SPINNER" bold>
            C O S T R I C T
          </Text>
        </Box>
      ) : (
        <Text color="claudeBlue_FOR_SYSTEM_SPINNER" bold>
          COSTRICT
        </Text>
      )}
    </Box>
  );

  const contentPanel = (
    <Box width={contentWidth} flexDirection="column" paddingX={1} paddingY={1}>
      <Text wrap="truncate-end">
        <Text bold>CoStrict</Text>
        <Text> </Text>
        <Text color="claudeBlue_FOR_SYSTEM_SPINNER" bold>
          v{version}
        </Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        {truncate(modelLabel, contentWidth - 2)}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {metaRows.map(([label, value]) => (
          <Text key={label} wrap="truncate-end">
            <Text dimColor>{label}</Text>
            <Text dimColor>{' '.repeat(Math.max(1, 8 - label.length))}</Text>
            <Text>{truncate(value, valueWidth)}</Text>
          </Text>
        ))}
      </Box>

      <Box
        marginTop={1}
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        borderBottom={false}
        borderColor="subtle"
      />

      {isHorizontal && (
        <Text dimColor wrap="truncate-end">
          {truncate('Strict workflows: plan, test, spec, wiki — built in.', contentWidth - 2)}
        </Text>
      )}

      <Box marginTop={isHorizontal ? 1 : 0} flexDirection="column">
        <Text color="warning">Try</Text>
        {STARTER_COMMANDS.map(command => (
          <Text key={command} color="claudeBlue_FOR_SYSTEM_SPINNER" wrap="truncate-end">
            <Text dimColor>› </Text>
            {truncate(command, contentWidth - 4)}
          </Text>
        ))}
      </Box>
    </Box>
  );

  return (
    <Box
      width={width}
      flexDirection={isHorizontal ? 'row' : 'column'}
      borderStyle="single"
      borderColor="claudeBlue_FOR_SYSTEM_SPINNER"
    >
      {brandPanel}
      {isHorizontal && (
        <Box
          minHeight={13}
          borderStyle="single"
          borderColor="claudeBlue_FOR_SYSTEM_SPINNER"
          borderDimColor
          borderTop={false}
          borderBottom={false}
          borderLeft
          borderRight={false}
        />
      )}
      {!isHorizontal && (
        <Box
          width="100%"
          borderStyle="single"
          borderColor="claudeBlue_FOR_SYSTEM_SPINNER"
          borderDimColor
          borderTop
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
        />
      )}
      {contentPanel}
    </Box>
  );
}
