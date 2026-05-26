import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { ActivityRail } from './ActivityRail.js'
import type { ActivityRailState } from '../../utils/activityRail.js'

export const ACTIVITY_RAIL_MIN_COLUMNS = 120
export const ACTIVITY_RAIL_WIDTH = 34

export function shouldShowActivityRail(columns: number): boolean {
  return columns >= ACTIVITY_RAIL_MIN_COLUMNS
}

export function hasActivityRailContent(railState: ActivityRailState): boolean {
  return railState.activity.length > 0 || railState.changes.length > 0
}

type Props = {
  columns: number
  railState: ActivityRailState
  narrowSummary: string
  children: React.ReactNode
}

export function ActivityRailLayout({ columns, railState, narrowSummary, children }: Props): React.ReactNode {
  if (!hasActivityRailContent(railState)) {
    return <Box flexDirection="column">{children}</Box>
  }

  if (!shouldShowActivityRail(columns)) {
    return (
      <Box flexDirection="column">
        {children}
        <Text wrap="truncate-end">{narrowSummary}</Text>
      </Box>
    )
  }

  const chatWidth = Math.max(1, columns - ACTIVITY_RAIL_WIDTH)

  return (
    <Box flexDirection="row" width={columns}>
      <Box flexDirection="column" width={chatWidth}>
        {children}
      </Box>
      <ActivityRail state={railState} width={ACTIVITY_RAIL_WIDTH} />
    </Box>
  )
}
