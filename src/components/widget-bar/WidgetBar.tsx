import * as React from 'react';
import { Box, Text, stringWidth, useTheme, type TextProps } from '@anthropic/ink';
import { getDesignTokens, type DesignTokenColor } from '../../utils/designTokens.js';
import { getTerminalCapabilities, getTerminalGlyphs } from '../../utils/terminalCapabilities.js';
import type { WidgetBarState, WidgetItem, WidgetTone } from '../../utils/widgetBar.js';

type Props = {
  state: WidgetBarState;
  columns: number;
};

type InkTextColor = NonNullable<TextProps['color']>;
type Tokens = ReturnType<typeof getDesignTokens>;
type Segment = WidgetItem & { displayLabel: string };

const MODEL_MIN_WIDTH = 8;
const SEGMENT_HORIZONTAL_PADDING = 2;
const POWERLINE_SEPARATOR_WIDTH = 1;

function segmentWidth(segment: Segment, powerline: boolean): number {
  return stringWidth(segment.displayLabel) + SEGMENT_HORIZONTAL_PADDING + (powerline ? POWERLINE_SEPARATOR_WIDTH : 0);
}

function asciiSegmentWidth(segment: Segment): number {
  return stringWidth(segment.displayLabel);
}

function inkColor(color: DesignTokenColor): InkTextColor {
  return color;
}

function toneColor(tone: WidgetTone, tokens: Tokens): InkTextColor {
  if (tone === 'success') return inkColor(tokens.success);
  if (tone === 'warning') return inkColor(tokens.warning);
  if (tone === 'error') return inkColor(tokens.error);
  if (tone === 'muted') return inkColor(tokens.muted);
  return inkColor(tokens.accent);
}

function fitText(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (stringWidth(value) <= maxWidth) return value;
  if (maxWidth === 1) return '…';

  let result = '';
  for (const char of value) {
    if (stringWidth(`${result}${char}…`) > maxWidth) break;
    result += char;
  }
  return `${result}…`;
}

function visibleSegments(widgets: WidgetItem[], availableWidth: number, powerline: boolean): Segment[] {
  if (availableWidth < MODEL_MIN_WIDTH || widgets.length === 0) return [];

  const [model, ...rest] = widgets;
  if (model === undefined) return [];

  const maxModelLabelWidth = Math.max(1, availableWidth - SEGMENT_HORIZONTAL_PADDING - (powerline ? 1 : 0));
  const segments: Segment[] = [{ ...model, displayLabel: fitText(model.label, maxModelLabelWidth) }];
  let usedWidth = powerline ? segmentWidth(segments[0]!, true) : asciiSegmentWidth(segments[0]!);

  for (const widget of rest) {
    const segment: Segment = { ...widget, displayLabel: widget.label };
    const nextWidth = powerline
      ? segmentWidth(segment, true)
      : usedWidth + stringWidth(' | ') + asciiSegmentWidth(segment);

    if (powerline) {
      if (usedWidth + segmentWidth(segment, true) > availableWidth) break;
      usedWidth += segmentWidth(segment, true);
    } else {
      if (nextWidth > availableWidth) break;
      usedWidth = nextWidth;
    }

    segments.push(segment);
  }

  return segments;
}

function renderPowerlineSegments(segments: Segment[], tokens: Tokens): React.ReactNode {
  return segments.map(segment => {
    const color = toneColor(segment.tone, tokens);
    return (
      <React.Fragment key={segment.key}>
        <Text backgroundColor="userMessageBackground" color={color} wrap="truncate-end">
          {` ${segment.displayLabel} `}
        </Text>
        <Text color="userMessageBackground" wrap="truncate-end">
          {''}
        </Text>
      </React.Fragment>
    );
  });
}

function renderAsciiSegments(segments: Segment[], tokens: Tokens): React.ReactNode {
  return segments.map((segment, index) => (
    <React.Fragment key={segment.key}>
      {index > 0 && <Text color={inkColor(tokens.muted)}> | </Text>}
      <Text color={toneColor(segment.tone, tokens)} wrap="truncate-end">
        {segment.displayLabel}
      </Text>
    </React.Fragment>
  ));
}

export function WidgetBar({ state, columns }: Props): React.ReactNode {
  const [theme] = useTheme();
  const capabilities = getTerminalCapabilities(process.env, columns);
  const glyphs = getTerminalGlyphs(capabilities);
  const tokens = getDesignTokens(theme, capabilities);
  const powerline = capabilities.charset === 'unicode' && glyphs.statusSeparator === '';
  const shortcutsWidth = Math.min(stringWidth(state.shortcuts), columns);
  const statusWidth = Math.max(0, columns - shortcutsWidth - 1);
  const segments = visibleSegments(state.widgets, statusWidth, powerline);

  return (
    <Box width="100%" flexShrink={0} justifyContent="space-between">
      {segments.length > 0 ? (
        <Box width={statusWidth} flexShrink={1}>
          {powerline ? renderPowerlineSegments(segments, tokens) : renderAsciiSegments(segments, tokens)}
        </Box>
      ) : (
        <Text> </Text>
      )}
      <Text color={inkColor(tokens.muted)} wrap="truncate-end">
        {state.shortcuts}
      </Text>
    </Box>
  );
}
