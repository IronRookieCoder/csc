import { describe, expect, test } from 'bun:test'
import * as promptInputFooterModule from '../PromptInputFooter.js'
import * as promptInputModule from '../PromptInput.js'

describe('PromptInputFooter Matrix Tactical hint suppression', () => {
  test('suppresses standalone footer hints when Matrix status line is visible', () => {
    const shouldSuppressPromptFooterHint = (
      promptInputFooterModule as Record<string, unknown>
    ).shouldSuppressPromptFooterHint

    expect(typeof shouldSuppressPromptFooterHint).toBe('function')
    expect(
      (
        shouldSuppressPromptFooterHint as (options: {
          suppressHintFromProps: boolean
          showStatusLine: boolean
          isMatrixStatusLine: boolean
          isSearching: boolean
        }) => boolean
      )({
        suppressHintFromProps: false,
        showStatusLine: true,
        isMatrixStatusLine: true,
        isSearching: false,
      }),
    ).toBe(true)
  })
})

describe('PromptInputFooter Matrix Tactical layout', () => {
  test('uses full-width footer padding so status line aligns with input area', () => {
    const getPromptFooterPaddingX = (
      promptInputFooterModule as Record<string, unknown>
    ).getPromptFooterPaddingX

    expect(typeof getPromptFooterPaddingX).toBe('function')
    expect(
      (
        getPromptFooterPaddingX as (options: {
          isMatrixStatusLine: boolean
        }) => number
      )({ isMatrixStatusLine: true }),
    ).toBe(0)
  })
})

describe('PromptInput container chrome', () => {
  test('does not draw a border for matrix-tactical theme', () => {
    expect(promptInputModule.getPromptInputContainerBorderStyle('matrix-tactical')).toBeUndefined()
  })

  test('draws a round border for non-matrix themes', () => {
    expect(promptInputModule.getPromptInputContainerBorderStyle('dark')).toBe('round')
    expect(promptInputModule.getPromptInputContainerBorderStyle('light')).toBe('round')
  })
})

describe('PromptInput text input width', () => {
  test('subtracts the full Matrix Tactical prompt cursor width', () => {
    const getPromptTextInputColumns = (
      promptInputModule as Record<string, unknown>
    ).getPromptTextInputColumns

    expect(typeof getPromptTextInputColumns).toBe('function')
    expect(
      (
        getPromptTextInputColumns as (options: {
          terminalColumns: number
          companionColumns: number
          theme: string
        }) => number
      )({
        terminalColumns: 80,
        companionColumns: 0,
        theme: 'matrix-tactical',
      }),
    ).toBe(65)
  })
})
