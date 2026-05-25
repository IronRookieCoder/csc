import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToString } from '../../../utils/staticRender.js'
import { ActivityRail } from '../ActivityRail.js'
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
  })
})
