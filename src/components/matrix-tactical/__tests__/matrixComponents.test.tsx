import React from 'react';
import { Box, Byline, Text } from '@anthropic/ink';
import { describe, expect, test } from 'bun:test';
import { MatrixWelcome } from '../MatrixWelcome.js';
import { MatrixMessageLine } from '../MatrixMessageLine.js';
import { MatrixPermissionFrame } from '../MatrixPermissionFrame.js';
import { MatrixPromptCursor, MatrixFooterHint } from '../MatrixPrompt.js';
import { MatrixStatusLineContent } from '../MatrixStatusLine.js';
import { MatrixToolUseLine } from '../MatrixToolUseLine.js';
import { PermissionRequestTitle } from '../../permissions/PermissionRequestTitle.js';
import { formatCountdown } from '../../BuiltinStatusLine.js';
import * as assistantToolUseMessageModule from '../../messages/AssistantToolUseMessage.js';

function collectText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (React.isValidElement(node)) {
    if (
      node.type === MatrixWelcome ||
      node.type === MatrixMessageLine ||
      node.type === MatrixPermissionFrame ||
      node.type === MatrixPromptCursor ||
      node.type === MatrixFooterHint ||
      node.type === MatrixStatusLineContent ||
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
  if (Array.isArray(node)) return node.some(child => hasTextWrappedBox(child, insideText));
  if (React.isValidElement(node)) {
    if (
      node.type === MatrixWelcome ||
      node.type === MatrixMessageLine ||
      node.type === MatrixPermissionFrame ||
      node.type === MatrixPromptCursor ||
      node.type === MatrixFooterHint ||
      node.type === MatrixStatusLineContent ||
      node.type === MatrixToolUseLine ||
      node.type === PermissionRequestTitle
    ) {
      const Component = node.type as (props: { children?: React.ReactNode }) => React.ReactNode;
      return hasTextWrappedBox(Component(node.props as { children?: React.ReactNode }), insideText);
    }
    if (node.type === Box && insideText) return true;
    return hasTextWrappedBox((node.props as { children?: React.ReactNode }).children, insideText || node.type === Text);
  }
  return false;
}

function findPermissionTitleColor(node: unknown): unknown {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number')
    return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const color = findPermissionTitleColor(child);
      if (color !== undefined) return color;
    }
    return undefined;
  }
  if (React.isValidElement(node)) {
    if (node.type === MatrixPermissionFrame) {
      const Component = node.type as (props: { children?: React.ReactNode }) => React.ReactNode;
      return findPermissionTitleColor(Component(node.props as { children?: React.ReactNode }));
    }
    if (node.type === PermissionRequestTitle) {
      return (node.props as { color?: unknown }).color;
    }
    return findPermissionTitleColor((node.props as { children?: React.ReactNode }).children);
  }
  return undefined;
}

function findFirstBoxProps(node: unknown): Record<string, unknown> | undefined {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number')
    return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const props = findFirstBoxProps(child);
      if (props !== undefined) return props;
    }
    return undefined;
  }
  if (React.isValidElement(node)) {
    if (node.type === MatrixStatusLineContent) {
      const Component = node.type as (props: { children?: React.ReactNode }) => React.ReactNode;
      return findFirstBoxProps(Component(node.props as { children?: React.ReactNode }));
    }
    if (node.type === Box) return node.props as Record<string, unknown>;
    return findFirstBoxProps((node.props as { children?: React.ReactNode }).children);
  }
  return undefined;
}

function findBoxPropsAtDepth(node: unknown, targetDepth: number, depth = 0): Record<string, unknown> | undefined {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number')
    return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const props = findBoxPropsAtDepth(child, targetDepth, depth);
      if (props !== undefined) return props;
    }
    return undefined;
  }
  if (React.isValidElement(node)) {
    if (node.type === MatrixStatusLineContent) {
      const Component = node.type as (props: { children?: React.ReactNode }) => React.ReactNode;
      return findBoxPropsAtDepth(Component(node.props as { children?: React.ReactNode }), targetDepth, depth);
    }
    const nextDepth = node.type === Box ? depth + 1 : depth;
    if (node.type === Box && nextDepth === targetDepth) return node.props as Record<string, unknown>;
    return findBoxPropsAtDepth((node.props as { children?: React.ReactNode }).children, targetDepth, nextDepth);
  }
  return undefined;
}

describe('MatrixWelcome', () => {
  test('renders COSTRICT banner and startup lines', () => {
    const text = collectText(<MatrixWelcome version="2.1.888" />);
    expect(text).toContain('██████╗ ██████╗');
    expect(text).toContain('[SYS]');
    expect(text).toContain('[OK]');
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
    expect(text).toContain('[RUN]');
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
    expect(text).toContain('[REQ]');
    expect(text).toContain('Bash permission');
    expect(text).toContain('[CUE]');
    expect(text).toContain('npm install -D vitest');
  });

  test('uses frame color as title fallback', () => {
    const color = findPermissionTitleColor(
      <MatrixPermissionFrame title="Bash permission" color="error">
        <span>npm install -D vitest</span>
      </MatrixPermissionFrame>,
    );

    expect(color).toBe('error');
  });
});

describe('MatrixPrompt', () => {
  test('renders prompt cursor', () => {
    const text = collectText(<MatrixPromptCursor />);
    expect(text).toContain('[costrict] >>');
  });

  test('renders prompt cursor as a flat inline input prefix', () => {
    const prompt = <MatrixPromptCursor />;
    const text = collectText(prompt);
    expect(text).toBe('[costrict] >> ');
    expect(hasTextWrappedBox(prompt)).toBe(false);
  });

  test('renders footer hint with CUE prefix', () => {
    const text = collectText(<MatrixFooterHint>shift+tab cycle mode</MatrixFooterHint>);
    expect(text).toContain('[CUE]');
    expect(text).toContain('shift+tab cycle mode');
  });

  test('keeps footer hint inline when wrapped by footer text', () => {
    const footer = (
      <Text>
        <Byline>
          <MatrixFooterHint>shift+tab cycle mode</MatrixFooterHint>
        </Byline>
      </Text>
    );

    expect(hasTextWrappedBox(footer)).toBe(false);
  });
});

describe('Matrix spinner colors', () => {
  test('uses Matrix green for active spinner text instead of warning or error colors', () => {
    const theme = require('../../../utils/theme.js').getTheme('matrix-tactical') as Record<string, string>;

    expect(theme.claude).toBe('rgb(52,211,153)');
    expect(theme.claudeShimmer).toBe('rgb(110,231,183)');
    expect(theme.claude).not.toBe(theme.warning);
    expect(theme.claude).not.toBe(theme.error);
  });
});

describe('MatrixToolUseLine', () => {
  test('renders working tool line with ASCII progress', () => {
    const text = collectText(
      <MatrixToolUseLine name="Bash" detail="bunx tsc --noEmit" state="working" progressPercent={70} />,
    );
    expect(text).toContain('[RUN]');
    expect(text).toContain('Bash');
    expect(text).toContain('bunx tsc --noEmit');
    expect(text).toContain('[====================>.........] 70%');
  });

  test('renders errored tool line', () => {
    const text = collectText(<MatrixToolUseLine name="Bash" detail="exit 1" state="error" />);
    expect(text).toContain('[ERR]');
    expect(text).toContain('exit 1');
  });

  test('renders queued tool line with queued tone', () => {
    const text = collectText(<MatrixToolUseLine name="Bash" detail="waiting" state="queued" />);
    expect(text).toContain('[RUN]');
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

describe('Matrix tool progress source', () => {
  test('does not invent a numeric progress percentage for active tools', () => {
    const getMatrixToolUseProgressPercent = (assistantToolUseMessageModule as Record<string, unknown>)
      .getMatrixToolUseProgressPercent;

    expect(typeof getMatrixToolUseProgressPercent).toBe('function');
    expect((getMatrixToolUseProgressPercent as (state: 'working') => number | undefined)('working')).toBeUndefined();
  });
});

describe('MatrixStatusLine', () => {
  test('aligns status content with the Matrix prompt left edge', () => {
    const line = (
      <MatrixStatusLineContent
        modelName="Sonnet"
        contextUsedPct={0}
        usedTokens={0}
        contextWindowSize={200000}
        totalCostUsd={0}
        rateLimits={{}}
      />
    );
    const props = findFirstBoxProps(line);
    const contentProps = findBoxPropsAtDepth(line, 2);

    expect(props?.width).toBe('100%');
    expect(props?.backgroundColor).toBeUndefined();
    expect(props?.borderColor).toBe('rate_limit_empty');
    expect(props?.borderTop).toBe(true);
    expect(props?.borderBottom).toBe(false);
    expect(props?.marginTop).toBe(6);
    expect(props?.paddingX).toBeUndefined();
    expect(contentProps?.paddingX).toBeUndefined();
    expect(collectText(line)).not.toContain('────');
  });

  test('renders CSC status fields with Matrix prefix', () => {
    const sessionReset = Math.floor(Date.now() / 1000) + 3600;
    const weeklyReset = Math.floor(Date.now() / 1000) + 7 * 3600;
    const text = collectText(
      <MatrixStatusLineContent
        modelName="Sonnet 4.6"
        contextUsedPct={18}
        usedTokens={36000}
        contextWindowSize={200000}
        totalCostUsd={0.02}
        cacheText="Cache 82% 42:10"
        permissionMode="bypassPermissions"
        effortLevel="high"
        memoryText="271MB · pid:32784"
        cueText="? for shortcuts"
        rateLimits={{
          five_hour: { utilization: 0.03, resets_at: sessionReset },
          seven_day: { utilization: 0.07, resets_at: weeklyReset },
        }}
      />,
    );
    expect(text).toContain('[STAT]');
    expect(text).toContain('Sonnet 4.6');
    expect(text).toContain('Context 18%');
    expect(text).toContain('Session 3%');
    expect(text).toContain(formatCountdown(sessionReset));
    expect(text).toContain('Weekly 7%');
    expect(text).toContain(formatCountdown(weeklyReset));
    expect(text).toContain('$0.02');
    expect(text).toContain('Cache 82% 42:10');
    expect(text).toContain('bypass on');
    expect(text).toContain('Effort high');
    expect(text).toContain('271MB · pid:32784');
    expect(text).toContain('[CUE]');
    expect(text).toContain('? for shortcuts');
  });

  test('does not render a trailing separator for empty extra status items', () => {
    const text = collectText(
      <MatrixStatusLineContent
        modelName="Sonnet 4.6"
        contextUsedPct={37}
        usedTokens={73800}
        contextWindowSize={200000}
        totalCostUsd={2.93}
        cacheText="Cache 50% 56:55"
        permissionMode="bypassPermissions"
        effortLevel="high"
        memoryText="373.4MB · pid:33964"
        cueText="? for shortcuts"
        extraItems={[null]}
        rateLimits={{}}
      />,
    );

    expect(text.trim().endsWith('|')).toBe(false);
  });

  test('renders working hint inside the status line', () => {
    const text = collectText(
      <MatrixStatusLineContent
        modelName="Sonnet"
        contextUsedPct={0}
        usedTokens={0}
        contextWindowSize={200000}
        totalCostUsd={0}
        runText="esc to interrupt"
        rateLimits={{}}
      />,
    );

    expect(text).toContain('[RUN]');
    expect(text).toContain('esc to interrupt');
  });

  test('omits optional rate limit, cost, and cache fields when unavailable', () => {
    const text = collectText(
      <MatrixStatusLineContent
        modelName="Sonnet"
        contextUsedPct={0}
        usedTokens={0}
        contextWindowSize={200000}
        totalCostUsd={0}
        rateLimits={{}}
      />,
    );
    expect(text).toContain('[STAT]');
    expect(text).toContain('Sonnet');
    expect(text).toContain('Context 0%');
    expect(text).not.toContain('Session');
    expect(text).not.toContain('Weekly');
    expect(text).not.toContain('$');
    expect(text).not.toContain('Cache');
  });
});
