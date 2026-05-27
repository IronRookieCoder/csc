import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { describe, expect, test } from 'bun:test';
import { MatrixWelcome } from '../MatrixWelcome.js';
import { MatrixMessageLine } from '../MatrixMessageLine.js';
import { MatrixPermissionFrame } from '../MatrixPermissionFrame.js';
import { MatrixStatusLine } from '../MatrixStatusLine.js';
import { MatrixToolUseLine } from '../MatrixToolUseLine.js';
import { PermissionRequestTitle } from '../../permissions/PermissionRequestTitle.js';

function collectText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (React.isValidElement(node)) {
    if (
      node.type === MatrixWelcome ||
      node.type === MatrixMessageLine ||
      node.type === MatrixPermissionFrame ||
      node.type === MatrixStatusLine ||
      node.type === MatrixToolUseLine ||
      node.type === PermissionRequestTitle
    ) {
      const Component = node.type as (props: { children?: React.ReactNode }) => React.ReactNode;
      return collectText(Component(node.props as { children?: React.ReactNode }));
    }
    return collectText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

function hasTextWrappedBox(node: unknown, insideText = false): boolean {
  if (node == null || typeof node === 'boolean') return false;
  if (typeof node === 'string' || typeof node === 'number') return false;
  if (Array.isArray(node)) return node.some((child) => hasTextWrappedBox(child, insideText));
  if (React.isValidElement(node)) {
    if (
      node.type === MatrixWelcome ||
      node.type === MatrixMessageLine ||
      node.type === MatrixPermissionFrame ||
      node.type === MatrixStatusLine ||
      node.type === MatrixToolUseLine ||
      node.type === PermissionRequestTitle
    ) {
      const Component = node.type as (props: { children?: React.ReactNode }) => React.ReactNode;
      return hasTextWrappedBox(Component(node.props as { children?: React.ReactNode }), insideText);
    }
    if (node.type === Box && insideText) return true;
    return hasTextWrappedBox(
      (node.props as { children?: React.ReactNode }).children,
      insideText || node.type === Text,
    );
  }
  return false;
}

describe('MatrixWelcome', () => {
  test('renders COSTRICT banner and startup lines', () => {
    const text = collectText(<MatrixWelcome version="2.1.888" />);
    expect(text).toContain('██████╗ ██████╗');
    expect(text).toContain('[SYS ]');
    expect(text).toContain('[OK  ]');
    expect(text).toContain('2.1.888');
  });
});

describe('MatrixMessageLine', () => {
  test('renders prefix and content', () => {
    const text = collectText(
      <MatrixMessageLine label="RUN" tone="warning">
        分析指令意图
      </MatrixMessageLine>,
    );
    expect(text).toContain('[RUN ]');
    expect(text).toContain('分析指令意图');
  });
});

describe('MatrixPermissionFrame', () => {
  test('renders approval frame with REQ and CUE markers', () => {
    const text = collectText(
      <MatrixPermissionFrame title="Bash permission">
        <span>npm install -D vitest</span>
      </MatrixPermissionFrame>,
    );
    expect(text).toContain('[REQ ]');
    expect(text).toContain('Bash permission');
    expect(text).toContain('[CUE ]');
    expect(text).toContain('npm install -D vitest');
  });
});

describe('MatrixToolUseLine', () => {
  test('renders working tool line with ASCII progress', () => {
    const text = collectText(
      <MatrixToolUseLine
        name="Bash"
        detail="bunx tsc --noEmit"
        state="working"
        progressPercent={70}
      />,
    );
    expect(text).toContain('[RUN ]');
    expect(text).toContain('Bash');
    expect(text).toContain('bunx tsc --noEmit');
    expect(text).toContain('[====================>.........] 70%');
  });

  test('renders errored tool line', () => {
    const text = collectText(<MatrixToolUseLine name="Bash" detail="exit 1" state="error" />);
    expect(text).toContain('[ERR ]');
    expect(text).toContain('exit 1');
  });

  test('renders queued tool line with queued tone', () => {
    const text = collectText(<MatrixToolUseLine name="Bash" detail="waiting" state="queued" />);
    expect(text).toContain('[RUN ]');
    expect(text).toContain('Bash');
    expect(text).toContain('waiting');
  });

  test('preserves tool use tag after detail', () => {
    const line = (
      <MatrixToolUseLine
        name="Task"
        detail="analyze"
        state="working"
        tag={
          <Box>
            <Text color="warning"> timeout: 30s</Text>
          </Box>
        }
      />
    );
    const text = collectText(line);
    expect(text).toContain('Task');
    expect(text).toContain('analyze');
    expect(text).toContain('timeout: 30s');
    expect(hasTextWrappedBox(line)).toBe(false);
  });
});

describe('MatrixStatusLine', () => {
  test('renders CSC status fields with Matrix prefix', () => {
    const text = collectText(
      <MatrixStatusLine
        modelName="Sonnet 4.6"
        contextUsedPct={18}
        usedTokens={36000}
        contextWindowSize={200000}
        totalCostUsd={0.02}
        cacheText="Cache 82% 42:10"
        rateLimits={{
          five_hour: { utilization: 0.03, resets_at: 0 },
          seven_day: { utilization: 0.07, resets_at: 0 },
        }}
      />,
    );
    expect(text).toContain('[STAT]');
    expect(text).toContain('Sonnet 4.6');
    expect(text).toContain('Context 18%');
    expect(text).toContain('Session 3%');
    expect(text).toContain('Weekly 7%');
    expect(text).toContain('$0.02');
    expect(text).toContain('Cache 82% 42:10');
  });
});
