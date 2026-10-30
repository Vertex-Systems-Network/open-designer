import { afterAll, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { initCanvasKit } from '@open-pencil/core/io/formats/raster'
import { SceneGraph } from '@open-pencil/scene-graph'

const ck = await initCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1), 'surface'))

afterAll(() => renderer.destroy())

test('filters are shared by their parameters and bounded, freeing the ones that fall out', () => {
  const first = expectDefined(renderer.getCachedBlur(1), 'blur')
  expect(renderer.getCachedBlur(1)).toBe(first)
  const shadow = renderer.getCachedDropShadow(2, 3, 1.5, ck.BLACK)
  expect(renderer.getCachedDropShadow(2, 3, 1.5, ck.BLACK)).toBe(shadow)
  expect(renderer.imageFilterCache.size).toBe(2)

  // A slider dragged through hundreds of radii keeps only the latest filters.
  for (let step = 0; step < 300; step++) renderer.getCachedBlur(2 + step * 0.01)
  expect(renderer.imageFilterCache.size).toBeLessThanOrEqual(256)
  expect(first.isDeleted()).toBe(true)
  expect(renderer.getCachedBlur(1)).not.toBe(first)

  const mask = expectDefined(renderer.getCachedMaskBlur(1), 'mask blur')
  for (let step = 0; step < 300; step++) renderer.getCachedMaskBlur(2 + step * 0.01)
  expect(renderer.maskFilterCache.size).toBeLessThanOrEqual(256)
  expect(mask.isDeleted()).toBe(true)
})

test('forgetting a layer drops the fonts it was waiting for and its text picture state', () => {
  const graph = new SceneGraph()
  const page = expectDefined(graph.getPages()[0], 'page')
  const node = graph.createNode('TEXT', page.id, { text: 'hello' })
  renderer.trackFontDemand(node, 'Inter|400')
  renderer.textPictureGenerations.set(node.id, { data: new Uint8Array(1), generation: 0 })
  expect(renderer.pendingFontNodes.has(node.id)).toBe(true)

  renderer.forgetNode(node.id)

  expect(renderer.pendingFontNodes.has(node.id)).toBe(false)
  expect(renderer.textPictureGenerations.has(node.id)).toBe(false)
})
