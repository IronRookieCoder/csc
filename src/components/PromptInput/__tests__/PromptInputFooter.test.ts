import { describe, expect, test } from 'bun:test'
import * as promptInputFooterModule from '../PromptInputFooter.js'
import { getPromptInputContainerBorderStyle } from '../PromptInput.js'

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
  test('does not draw a border around the input box', () => {
    expect(getPromptInputContainerBorderStyle()).toBeUndefined()
  })
})
