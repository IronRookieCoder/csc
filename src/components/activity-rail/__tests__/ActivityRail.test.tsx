import { describe, expect, test } from 'bun:test'
import { Box, Text } from '@anthropic/ink'
import * as React from 'react'
import { renderToString } from '../../../utils/staticRender.js'
import { ActivityRail } from '../ActivityRail.js'
import { ActivityRailLayout, hasActivityRailContent } from '../ActivityRailLayout.js'
import {
  getFullscreenMainColumnWidth,
  getFullscreenMainTerminalSize,
  getFullscreenSideRailPaddingTop,
} from '../../FullscreenLayout.js'
import type { ActivityRailState } from '../../../utils/activityRail.js'

const state: ActivityRailState = {
  activity: [
    { id: 'read', title: '读取上下文', detail: 'src/login.ts', status: 'done' },
    { id: 'edit', title: '准备改动', detail: 'src/login.ts', status: 'running' },
  ],
  changes: [
    { filePath: 'src/login.ts', diffStat: 'modified', status: 'running' },
  ],
  quality: [
    { id: 'requirements', label: '需求一致性', status: '待确认' },
    { id: 'impact', label: '影响范围', status: '需关注' },
    { id: 'verification', label: '测试验证', status: '待执行' },
  ],
}

describe('ActivityRail', () => {
  test('renders activity, change set, and quality gate', async () => {
    const out = await renderToString(<ActivityRail state={state} width={34} />)

    expect(out).toContain('Activity')
    expect(out).toContain('读取上下文')
    expect(out).toContain('Change Set')
    expect(out).toContain('src/login.ts')
    expect(out).toContain('Quality Gate')
    expect(out).toContain('测试验证')
  })

  test('renders as a framed panel to match the welcome area', async () => {
    const out = await renderToString(<ActivityRail state={state} width={34} />)
    const firstLine = out.split('\n')[0] ?? ''

    expect(firstLine).toContain('╭')
    expect(firstLine).toContain('╮')
  })

  test('renders empty state without crashing', async () => {
    const out = await renderToString(
      <ActivityRail
        width={34}
        state={{
          activity: [],
          changes: [],
          quality: [],
        }}
      />,
    )

    expect(out).toContain('Activity')
    expect(out).toContain('No activity')
    expect(out).toContain('No file changes')
    expect(out).toContain('No gates')
  })

  test('truncates long rail text within a narrow width', async () => {
    const out = await renderToString(
      <ActivityRail
        width={34}
        state={{
          activity: [
            {
              id: 'long',
              title: '读取一个非常非常非常非常非常非常非常非常长的上下文标题',
              detail: 'src/some/deeply/nested/path/with/a/very/very/very/long/file-name.ts',
              status: 'running',
            },
          ],
          changes: [
            {
              filePath: 'src/some/deeply/nested/path/with/a/very/very/very/long/file-name.ts',
              diffStat: 'modified-with-a-very-long-status-description',
              status: 'running',
            },
          ],
          quality: [
            {
              id: 'verification',
              label: '测试验证结果需要展示一个非常非常非常非常长的说明',
              status: '待执行',
            },
          ],
        }}
      />,
    )

    expect(out).toContain('Activity')
    expect(out).toContain('Change Set')
    expect(out).toContain('Quality Gate')
    expect(out.split('\n').length).toBeLessThanOrEqual(14)
  })
})

describe('ActivityRailLayout', () => {
  const emptyState: ActivityRailState = {
    activity: [],
    changes: [],
    quality: [
      { id: 'requirements', label: '需求一致性', status: '待执行' },
      { id: 'impact', label: '影响范围', status: '待执行' },
      { id: 'verification', label: '测试验证', status: '待执行' },
    ],
  }

  test('does not render rail or summary before activity exists', async () => {
    const out = await renderToString(
      <ActivityRailLayout
        columns={140}
        railState={emptyState}
        narrowSummary="Tools: idle | 0 files changed | tests pending"
      >
        <Box flexDirection="column">
          <Text>欢迎页</Text>
        </Box>
      </ActivityRailLayout>,
      140,
    )

    expect(out).toContain('欢迎页')
    expect(out).not.toContain('Activity')
    expect(out).not.toContain('Tools: idle')
  })

  test('reports rail content only when activity or changes exist', () => {
    expect(hasActivityRailContent(emptyState)).toBe(false)
    expect(hasActivityRailContent(state)).toBe(true)
  })

  test('renders rail beside chat when wide', async () => {
    const out = await renderToString(
      <ActivityRailLayout
        columns={140}
        railState={state}
        narrowSummary="Tools: 2 done | 1 file changed | tests pending"
      >
        <Box flexDirection="column">
          <Text>聊天主体</Text>
        </Box>
      </ActivityRailLayout>,
      140,
    )

    expect(out).toContain('聊天主体')
    expect(out).toContain('Activity')
    expect(out).toContain('Quality Gate')
  })

  test('renders summary instead of rail when narrow', async () => {
    const out = await renderToString(
      <ActivityRailLayout
        columns={100}
        railState={state}
        narrowSummary="Tools: 2 done | 1 file changed | tests pending"
      >
        <Box flexDirection="column">
          <Text>聊天主体</Text>
        </Box>
      </ActivityRailLayout>,
      100,
    )

    expect(out).toContain('聊天主体')
    expect(out).toContain('Tools: 2 done')
    expect(out).not.toContain('Quality Gate')
  })
})

describe('FullscreenLayout side rail sizing', () => {
  test('reserves fixed rail width outside the scrollbox', () => {
    expect(getFullscreenMainColumnWidth(140, 34)).toBe(106)
    expect(getFullscreenMainColumnWidth(140)).toBe(140)
    expect(getFullscreenMainColumnWidth(20, 34)).toBe(1)
  })

  test('scopes main terminal size to the scrollbox column width', () => {
    expect(getFullscreenMainTerminalSize(40, 140, 34)).toEqual({ rows: 40, columns: 106 })
    expect(getFullscreenMainTerminalSize(40, 140)).toEqual({ rows: 40, columns: 140 })
  })

  test('aligns the side rail with the first conversation row after the logo', () => {
    expect(getFullscreenSideRailPaddingTop(false)).toBe(8)
    expect(getFullscreenSideRailPaddingTop(true)).toBe(0)
  })
})
