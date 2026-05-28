import { describe, expect, test } from 'bun:test'
import * as promptInputFooterModule from '../PromptInputFooter.js'

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
