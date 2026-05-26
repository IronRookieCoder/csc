import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToString } from '../../../utils/staticRender.js';
import { TopBar } from '../TopBar.js';
import type { TopBarState } from '../../../utils/topBar.js';

const baseState: TopBarState = {
  mode: 'idle',
  sessionTitle: 'Fix login timeout',
  branch: 'docs/csc-ui-redesign',
  brandVersion: 'CoStrict v4.0.13',
  layout: { kind: 'full', showFullPipeline: true, showRail: true, maxWidgets: 8 },
  pipeline: [
    { id: 'context', title: 'Context', status: 'done' },
    { id: 'locate', title: 'Locate', status: 'done' },
    { id: 'edit', title: 'Changes', status: 'running', detail: 'src/login.ts' },
    { id: 'verify', title: 'Verify', status: 'pending' },
  ],
};

describe('TopBar', () => {
  test('renders idle project information', async () => {
    const out = await renderToString(<TopBar state={baseState} columns={140} charset="unicode" />);

    expect(out).toContain('Fix login timeout');
    expect(out).toContain('docs/csc-ui-redesign');
    expect(out).toContain('CoStrict v4.0.13');
    expect(out).not.toContain('Context');
  });

  test('hides branch in minimal idle layout', async () => {
    const out = await renderToString(
      <TopBar
        state={{
          ...baseState,
          layout: { kind: 'minimal', showFullPipeline: false, showRail: false, maxWidgets: 2 },
        }}
        columns={70}
        charset="unicode"
      />,
    );

    expect(out).toContain('Fix login timeout');
    expect(out).toContain('CoStrict v4.0.13');
    expect(out).not.toContain('docs/csc-ui-redesign');
  });

  test('renders active full pipeline', async () => {
    const out = await renderToString(
      <TopBar state={{ ...baseState, mode: 'active' }} columns={140} charset="unicode" />,
    );

    expect(out).toContain('✓ Context');
    expect(out).toContain('✓ Locate');
    expect(out).toContain('◷ Changes');
    expect(out).toContain('○ Verify');
    expect(out).toContain('━');
  });

  test('renders only the current phase in compact layout', async () => {
    const out = await renderToString(
      <TopBar
        state={{
          ...baseState,
          mode: 'active',
          layout: { kind: 'compact', showFullPipeline: false, showRail: true, maxWidgets: 6 },
        }}
        columns={130}
        charset="unicode"
      />,
    );

    expect(out).toContain('◷ Changes');
    expect(out).not.toContain('✓ Context');
    expect(out).not.toContain('○ Verify');
  });

  test('renders only the current phase in single layout', async () => {
    const out = await renderToString(
      <TopBar
        state={{
          ...baseState,
          mode: 'active',
          layout: { kind: 'single', showFullPipeline: false, showRail: false, maxWidgets: 4 },
        }}
        columns={100}
        charset="unicode"
      />,
    );

    expect(out).toContain('◷ Changes');
    expect(out).not.toContain('✓ Context');
    expect(out).not.toContain('○ Verify');
  });

  test('prioritizes attention over running in compact current phase', async () => {
    const out = await renderToString(
      <TopBar
        state={{
          ...baseState,
          mode: 'active',
          layout: { kind: 'compact', showFullPipeline: false, showRail: true, maxWidgets: 6 },
          pipeline: [
            { id: 'context', title: 'Context', status: 'attention' },
            { id: 'locate', title: 'Locate', status: 'done' },
            { id: 'edit', title: 'Changes', status: 'running' },
            { id: 'verify', title: 'Verify', status: 'pending' },
          ],
        }}
        columns={130}
        charset="unicode"
      />,
    );

    expect(out).toContain('! Context');
    expect(out).not.toContain('◷ Changes');
  });

  test('uses ascii glyphs when unicode is unavailable', async () => {
    const out = await renderToString(<TopBar state={{ ...baseState, mode: 'active' }} columns={140} charset="ascii" />);

    expect(out).toContain('[OK] Context');
    expect(out).toContain('[OK] Locate');
    expect(out).toContain('[..] Changes');
    expect(out).toContain('[  ] Verify');
    expect(out).toContain('-');
    expect(out).not.toContain('━');
  });

  test('accepts indexed color depth fallback without changing output text', async () => {
    const out = await renderToString(
      <TopBar state={{ ...baseState, mode: 'active' }} columns={140} charset="unicode" colorDepth="indexed" />,
    );

    expect(out).toContain('✓ Context');
    expect(out).toContain('◷ Changes');
    expect(out).toContain('○ Verify');
  });
});
