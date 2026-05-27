import React from 'react';
import { describe, expect, test } from 'bun:test';
import { MatrixWelcome } from '../MatrixWelcome.js';
import { MatrixMessageLine } from '../MatrixMessageLine.js';
import { MatrixPermissionFrame } from '../MatrixPermissionFrame.js';
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
      node.type === PermissionRequestTitle
    ) {
      const Component = node.type as (props: { children?: React.ReactNode }) => React.ReactNode;
      return collectText(Component(node.props as { children?: React.ReactNode }));
    }
    return collectText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
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
