import * as React from 'react'
import { Box, type DOMElement, Text } from '@anthropic/ink'
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

export function getActivityRailTopPadding(anchorTop: number | null): number {
  if (anchorTop === null) return 0
  return Math.max(0, anchorTop - 1)
}

export function getElementAbsoluteTop(element: DOMElement | null): number | null {
  if (!element?.yogaNode) return null

  let top = element.yogaNode.getComputedTop()
  let parent = element.parentNode
  while (parent) {
    if (parent.yogaNode) {
      top += parent.yogaNode.getComputedTop()
    }
    parent = parent.parentNode
  }
  return top
}

export function useElementAbsoluteTop(ref: React.RefObject<DOMElement | null> | undefined): number | null {
  const [top, setTop] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    if (!ref) {
      setTop(null)
      return
    }
    const nextTop = getElementAbsoluteTop(ref.current)
    setTop(Number.isFinite(nextTop) ? nextTop! : null)
  })

  return top
}

type Props = {
  columns: number
  railState: ActivityRailState
  narrowSummary: string
  anchorRef?: React.RefObject<DOMElement | null>
  children: React.ReactNode
}

export function ActivityRailLayout({
  columns,
  railState,
  narrowSummary,
  anchorRef,
  children,
}: Props): React.ReactNode {
  const anchorTop = useElementAbsoluteTop(anchorRef)

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
      <Box flexDirection="column" width={chatWidth} paddingTop={1}>
        {children}
      </Box>
      <Box flexDirection="column" width={ACTIVITY_RAIL_WIDTH} paddingTop={getActivityRailTopPadding(anchorTop)}>
        <ActivityRail state={railState} width={ACTIVITY_RAIL_WIDTH} />
      </Box>
    </Box>
  )
}
