import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import type { ActivityRailState, ActivityStatus, QualityGateItem } from '../../utils/activityRail.js'
import type { Theme } from '../../utils/theme.js'

type Props = {
  state: ActivityRailState
  width: number
}

type RailStatus = ActivityStatus | QualityGateItem['status']

function statusSymbol(status: RailStatus): string {
  if (status === 'done' || status === '通过') return '✓'
  if (status === 'running') return '◷'
  if (status === 'attention' || status === '需关注') return '!'
  if (status === '待确认') return '?'
  return '·'
}

function statusColor(status: RailStatus): keyof Theme {
  if (status === 'done' || status === '通过') return 'success'
  if (status === 'running') return 'warning'
  if (status === 'attention' || status === '需关注') return 'error'
  if (status === '待确认') return 'suggestion'
  return 'subtle'
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactNode {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{title}</Text>
      {children}
    </Box>
  )
}

export function ActivityRail({ state, width }: Props): React.ReactNode {
  const contentWidth = Math.max(1, width - 6)

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor="claudeBlue_FOR_SYSTEM_SPINNER"
      paddingX={1}
    >
      <Section title="Activity">
        {state.activity.length === 0 ? (
          <Text dimColor>No activity</Text>
        ) : (
          state.activity.map(item => (
            <Box key={item.id} flexDirection="column">
              <Box>
                <Text color={statusColor(item.status)}>{statusSymbol(item.status)} </Text>
                <Box width={contentWidth}>
                  <Text wrap="truncate-end">{item.title}</Text>
                </Box>
              </Box>
              {item.detail !== undefined && (
                <Box>
                  <Text dimColor>  </Text>
                  <Box width={contentWidth}>
                    <Text dimColor wrap="truncate-end">
                      {item.detail}
                    </Text>
                  </Box>
                </Box>
              )}
            </Box>
          ))
        )}
      </Section>

      <Section title="Change Set">
        {state.changes.length === 0 ? (
          <Text dimColor>No file changes</Text>
        ) : (
          state.changes.map(item => (
            <Box key={item.filePath}>
              <Text color={statusColor(item.status)}>{statusSymbol(item.status)} </Text>
              <Box width={contentWidth}>
                <Text wrap="truncate-end">{item.filePath}</Text>
              </Box>
              <Box width={contentWidth}>
                <Text dimColor wrap="truncate-end">
                  {' '}
                  {item.diffStat}
                </Text>
              </Box>
            </Box>
          ))
        )}
      </Section>

      <Section title="Quality Gate">
        {state.quality.length === 0 ? (
          <Text dimColor>No gates</Text>
        ) : (
          state.quality.map(item => (
            <Box key={item.id}>
              <Text color={statusColor(item.status)}>{statusSymbol(item.status)} </Text>
              <Box width={contentWidth}>
                <Text wrap="truncate-end">{item.label}</Text>
              </Box>
              <Box width={contentWidth}>
                <Text dimColor wrap="truncate-end">
                  {' '}
                  {item.status}
                </Text>
              </Box>
            </Box>
          ))
        )}
      </Section>
    </Box>
  )
}
