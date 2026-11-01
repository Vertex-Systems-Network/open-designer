import { describe, expect, test } from 'bun:test'

import { isDesignClipboardHTML } from '@/app/editor/clipboard/html'

describe('design clipboard HTML recognition', () => {
  test('accepts complete OpenDesigner and Figma clipboard comments', () => {
    expect(isDesignClipboardHTML('<!--(opendesigner)payload(/opendesigner)-->')).toBe(true)
    expect(isDesignClipboardHTML('<span data-buffer="<!--(figma)payload(/figma)-->"></span>')).toBe(
      true
    )
    expect(
      isDesignClipboardHTML('<span data-buffer="&lt;!--(figma)payload(/figma)--&gt;"></span>')
    ).toBe(true)
  })

  test('rejects malformed repeated opening markers', () => {
    expect(isDesignClipboardHTML('ordinary clipboard text')).toBe(false)
    const malformed = '<!--(opendesigner)'.repeat(10_000)

    expect(isDesignClipboardHTML(malformed)).toBe(false)
  })
})
