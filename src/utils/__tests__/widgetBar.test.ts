import { describe, expect, test } from 'bun:test'
import { deriveWidgetBarState } from '../widgetBar.js'

const baseInput = {
  columns: 150,
  modelName: 'vendor/future-model-12-4-alpha[1m]',
  contextUsedPct: 12.4,
  totalCostUsd: 0.34,
  cacheHitRate: 45.2,
  cacheCountdown: '52:18',
  linesAdded: 5,
  linesRemoved: 2,
}

describe('deriveWidgetBarState', () => {
  test('always returns the fixed csc segment order', () => {
    const result = deriveWidgetBarState(baseInput)

    expect(result.widgets).toEqual([
      { key: 'model', label: 'Model 12.4 Alpha 1M', tone: 'default' },
      { key: 'context', label: 'ctx 12%', tone: 'default' },
      { key: 'cache', label: 'Cache 45% 52:18', tone: 'default' },
      { key: 'cost', label: '$0.34', tone: 'default' },
      { key: 'branch', label: '- 5↑2↓', tone: 'default' },
    ])
    expect(result.shortcuts).toBe('Esc cancel · ? help · ↓ tasks')
  })

  test('compacts slug-like model ids dynamically', () => {
    const labels = [
      'vendor-alpha-2-5-pro',
      'nova-engine-5-turbo',
      'vendor.custom-model-12-beta[1m]',
    ].map(
      modelName =>
        deriveWidgetBarState({
          ...baseInput,
          modelName,
        }).widgets[0]?.label,
    )

    expect(labels).toEqual([
      'Alpha 2.5 Pro',
      'Engine 5 Turbo',
      'Model 12 Beta 1M',
    ])
  })

  test('keeps fixed segment order on narrow terminals', () => {
    const result = deriveWidgetBarState({
      ...baseInput,
      columns: 70,
      branch: 'docs/csc-ui-redesign',
    })

    expect(result.widgets.map(widget => widget.key)).toEqual([
      'model',
      'context',
      'cache',
      'cost',
      'branch',
    ])
    expect(result.widgets[4]).toEqual({
      key: 'branch',
      label: 'docs/csc-ui-redesign 5↑2↓',
      tone: 'default',
    })
    expect(result.shortcuts).toBe('? Help')
  })

  test('marks high utilization widgets as warning or error', () => {
    const warning = deriveWidgetBarState({
      ...baseInput,
      contextUsedPct: 81,
    })
    const error = deriveWidgetBarState({
      ...baseInput,
      contextUsedPct: 96,
    })
    const warningContext = warning.widgets.find(
      widget => widget.key === 'context',
    )
    const errorContext = error.widgets.find(widget => widget.key === 'context')

    expect(warningContext).toEqual({
      key: 'context',
      label: 'ctx 81%',
      tone: 'warning',
    })
    expect(errorContext).toEqual({
      key: 'context',
      label: 'ctx 96%',
      tone: 'error',
    })
  })

  test('derives cache null expired boundary labels', () => {
    const result = deriveWidgetBarState({
      ...baseInput,
      cacheHitRate: null,
      cacheCountdown: 'exp',
    })
    const cache = result.widgets.find(widget => widget.key === 'cache')

    expect(cache).toEqual(
      { key: 'cache', label: 'Cache --% exp', tone: 'muted' },
    )
  })

  test('uses compact shortcuts on narrow terminals', () => {
    const result = deriveWidgetBarState({
      ...baseInput,
      columns: 70,
    })

    expect(result.shortcuts).toBe('? Help')
  })
})
