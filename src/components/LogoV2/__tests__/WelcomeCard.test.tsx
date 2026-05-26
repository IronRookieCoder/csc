import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToString } from '../../../utils/staticRender.js';
import { WelcomeCard } from '../WelcomeCard.js';

describe('WelcomeCard', () => {
  test('renders a two-column CoStrict welcome card with project metadata and starter commands', async () => {
    const out = await renderToString(
      <WelcomeCard
        version="4.1.5"
        modelName="costrict-deepseek-v4-pro[1m]"
        cwd={'D:\\agent-coding\\csc'}
        columns={112}
      />,
      112,
    );

    expect(out).toContain('█▀▀ █▀█ █▀▀ ▀█▀ █▀█ █ █▀▀ ▀█▀');
    expect(out).toContain('█   █ █ ▀▀█  █  █▀▄ █ █    █');
    expect(out).toContain('▀▀▀ ▀▀▀ ▀▀▀  ▀  ▀ ▀ ▀ ▀▀▀  ▀');
    expect(out).toContain('CoStrict');
    expect(out).toContain('v4.1.5');
    expect(out).toContain('Deepseek V4 Pro 1M · Ready');
    expect(out).toContain('Project');
    expect(out).toContain('csc');
    expect(out).toContain('Branch');
    expect(out).toContain('no branch');
    expect(out).toContain('Path');
    expect(out).toContain('D:\\agent-coding\\csc');
    expect(out).toContain('Strict workflows: plan, test, spec, wiki — built in.');
    expect(out).toContain('Try');
    expect(out).toContain('/strict:plan');
    expect(out).toContain('/strict-test');
    expect(out).toContain('/strict-project-wiki');
    expect(out.split('\n')[0]).toContain('┌');
    expect(out.split('\n')[0].length).toBeGreaterThanOrEqual(110);
  });

  test('uses the compact spaced wordmark on standard wide terminals', async () => {
    const out = await renderToString(
      <WelcomeCard
        version="4.1.5"
        modelName="costrict-deepseek-v4-pro[1m]"
        cwd={'D:\\agent-coding\\csc'}
        columns={96}
      />,
      96,
    );

    expect(out).toContain('C O S T R I C T');
    expect(out).not.toContain('█▀▀ █▀█ █▀▀');
    expect(out).toContain('CoStrict v4.1.5');
    expect(out).toContain('Deepseek V4 Pro 1M · Ready');
    expect(out.split('\n')[0].length).toBeGreaterThanOrEqual(95);
  });

  test('falls back to a single-line logo on narrow terminals', async () => {
    const out = await renderToString(
      <WelcomeCard
        version="4.1.5"
        modelName="costrict-deepseek-v4-pro[1m]"
        cwd={'D:\\agent-coding\\csc'}
        columns={60}
      />,
      60,
    );

    expect(out).toContain('COSTRICT');
    expect(out).not.toContain('C O S T R I C T');
    expect(out).not.toContain('█▀▀ █▀█ █▀▀');
    expect(out).toContain('CoStrict v4.1.5');
  });
});
