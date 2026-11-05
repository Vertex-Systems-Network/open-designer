import { describe, expect, test } from 'bun:test'

import * as v from 'valibot'

import { SceneGraph } from '@open-designer/scene-graph'

import { FigmaAPI } from '#core/figma-api'
import { defineTool, TOOL_FONT_LOAD_TIMEOUT_MS } from '#core/tools/schema'

function fontTool() {
  return defineTool({
    name: 'test_font_tool',
    description: 'Test font loading.',
    execution: { kind: 'sync', mutation: 'none' },
    input: v.strictObject({}),
    fonts: () => [
      { family: 'Alpha', style: 'Regular' },
      { family: 'Beta', style: 'Bold' }
    ],
    execute: () => 'executed'
  })
}

describe('tool font loading', () => {
  test('starts loading all required faces before awaiting them', async () => {
    const loaded: string[] = []
    const pending: Array<() => void> = []
    const tool = fontTool()
    const figma = new FigmaAPI(new SceneGraph())
    figma.loadFontAsync = (font) => {
      loaded.push(font.family)
      return new Promise<void>((resolve) => {
        pending.push(resolve)
      })
    }

    const loading = tool.loadFonts(figma, {})
    expect(loaded).toEqual(['Alpha', 'Beta'])
    pending.forEach((resolve) => resolve())
    await loading

    expect(loaded).toEqual(['Alpha', 'Beta'])
  })

  test(
    'rejects with the font name when loading exceeds the deadline',
    async () => {
      const tool = fontTool()
      const figma = new FigmaAPI(new SceneGraph())
      figma.loadFontAsync = () =>
        new Promise<void>(() => {
          void 0
        })

      await expect(tool.loadFonts(figma, {})).rejects.toThrow(
        `Timed out loading font "Alpha Regular" after ${TOOL_FONT_LOAD_TIMEOUT_MS / 1000}s`
      )
    },
    TOOL_FONT_LOAD_TIMEOUT_MS + 2_000
  )
})
