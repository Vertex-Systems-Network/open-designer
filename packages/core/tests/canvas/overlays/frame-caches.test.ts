import { afterAll, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { initCanvasKit } from '@open-pencil/core/io/formats/raster'
import { SceneGraph } from '@open-pencil/scene-graph'

import { cachedGlyphWidth, measureGlyphWidth } from '#core/canvas/labels/paragraph-cache'
import { dashEffect, withScreenStroke } from '#core/canvas/overlays/outline'

const ck = await initCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(8, 8), 'surface'))

afterAll(() => renderer.destroy())

test('a screen stroke reuses its dash across frames at one zoom and makes another per zoom', () => {
  renderer.zoom = 1
  const canvas = renderer.surface.getCanvas()
  const draw = () => withScreenStroke(renderer, { color: ck.BLACK, dash: [4, 2] }, () => undefined)
  draw()
  draw()
  expect(renderer.dashEffects.size).toBe(1)
  const first = dashEffect(renderer, 4, 2)
  expect(dashEffect(renderer, 4, 2)).toBe(first)
  renderer.zoom = 2
  draw()
  expect(renderer.dashEffects.size).toBe(2)
  canvas.clear(ck.WHITE)
})

test('chrome colours are allocated once per theme', () => {
  const blue = renderer.selColor()
  expect(renderer.selColor()).toBe(blue)
  expect(renderer.selColor(0.5)).not.toBe(blue)
  expect(renderer.selColor(0.5)).toBe(renderer.selColor(0.5))
  renderer.setSelectionTheme({
    color: { r: 1, g: 0, b: 0, a: 1 },
    foreground: { r: 1, g: 1, b: 1, a: 1 }
  })
  const red = renderer.selColor()
  expect(red).not.toBe(blue)
  expect(Array.from(red).slice(0, 3)).toEqual([1, 0, 0])
  renderer.setSelectionTheme()
})

test('a label is measured once per font and text', () => {
  const font = new ck.Font(null, 11)
  try {
    const width = cachedGlyphWidth(renderer, font, '1234')
    expect(width).toBe(measureGlyphWidth(font, '1234'))
    expect(cachedGlyphWidth(renderer, font, '1234')).toBe(width)
    expect(renderer.glyphWidths.get(font)?.size).toBe(1)
  } finally {
    font.delete()
  }
})

test('one scene geometry serves a frame and the next frame starts afresh', () => {
  const graph = new SceneGraph()
  const geometry = renderer.sceneGeometry(graph, null)
  expect(renderer.sceneGeometry(graph, null)).toBe(geometry)
  expect(renderer.sceneGeometry(new SceneGraph(), null)).not.toBe(geometry)
  renderer.frameGeometry = null
  expect(renderer.sceneGeometry(graph, null)).not.toBe(geometry)
})
