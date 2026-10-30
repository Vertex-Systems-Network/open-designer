import { describe, expect, mock, test } from 'bun:test'

import type { Image as CKImage } from 'canvaskit-wasm'

import { TileImageCache, type RenderedTile } from '#core/canvas/renderer/tiles'

import { asDouble } from '../helpers'

function tile(x: number): RenderedTile {
  const image = asDouble<CKImage>({
    width: () => 256,
    height: () => 256,
    delete: mock()
  })
  return {
    key: { pageId: 'page', level: 1, x, y: 0 },
    image,
    chunkCount: 1,
    estimatedCost: 1,
    renderMs: 1,
    allocationMs: 0,
    drawMs: 1,
    flushMs: 0,
    snapshotMs: 0
  }
}

describe('tile image cache', () => {
  test('disposes rejected tiles without returning a deleted image', () => {
    const cache = new TileImageCache(1)
    const oversized = tile(0)
    expect(cache.install(oversized, 1)).toBeNull()
    expect(oversized.image.delete).toHaveBeenCalledTimes(1)
    expect(cache.size()).toBe(0)
    expect(cache.byteSize()).toBe(0)
    cache.clear()
    expect(oversized.image.delete).toHaveBeenCalledTimes(1)
  })

  test('replaces native images and reports memory', () => {
    const cache = new TileImageCache()
    const first = tile(0)
    const second = tile(0)
    cache.install(first, 1)
    cache.install(second, 2)

    expect(first.image.delete).toHaveBeenCalledTimes(1)
    expect(cache.size()).toBe(1)
    expect(cache.byteSize()).toBe(256 * 256 * 4)
    cache.clear()
    expect(second.image.delete).toHaveBeenCalledTimes(1)
  })

  test('invalidates intersecting tiles and advances unaffected generations', () => {
    const cache = new TileImageCache()
    const first = tile(0)
    const second = tile(1)
    cache.install(first, 1)
    cache.install(second, 1)

    expect(cache.invalidateBounds('page', { minX: 300, minY: 10, maxX: 340, maxY: 40 }, 2)).toBe(1)
    expect(cache.get(first.key)?.contentGeneration).toBe(2)
    expect(cache.get(second.key)).toBeNull()
    expect(second.image.delete).toHaveBeenCalledTimes(1)
    cache.clear()
  })

  test('evicts least recently used tiles within its byte budget', () => {
    const bytes = 256 * 256 * 4
    const cache = new TileImageCache(bytes * 2)
    const first = tile(0)
    const second = tile(1)
    const third = tile(2)
    cache.install(first, 1)
    cache.install(second, 1)
    cache.get(first.key)
    cache.install(third, 1)

    expect(second.image.delete).toHaveBeenCalledTimes(1)
    expect(cache.get(first.key)).not.toBeNull()
    expect(cache.get(third.key)).not.toBeNull()
    cache.clear()
  })
})

describe('tile fallback lookup', () => {
  function tileAt(level: number, x: number, y: number): RenderedTile {
    const rendered = tile(x)
    return { ...rendered, key: { pageId: 'page', level, x, y } }
  }

  test('covers a missing tile with the nearest level that spans its area', () => {
    const cache = new TileImageCache()
    // Level 1 tiles span 256 world units; level 2 tiles span 128.
    cache.install(tileAt(1, 0, 0), 1)
    cache.install(tileAt(0.5, 0, 0), 1)
    const fallback = cache.findFallback(
      { pageId: 'page', level: 2, x: 1, y: 1 },
      cache.fallbackLevels('page', 2)
    )
    expect(fallback?.map((entry) => entry.key.level)).toEqual([1])

    // Without the level-1 tile, the coarser level-0.5 tile still spans the area.
    cache.invalidateBounds('page', { minX: 0, minY: 0, maxX: 256, maxY: 256 }, 2)
    expect(
      cache.findFallback({ pageId: 'page', level: 2, x: 1, y: 1 }, cache.fallbackLevels('page', 2))
    ).toBeNull()
    cache.install(tileAt(0.5, 0, 0), 2)
    expect(
      cache
        .findFallback({ pageId: 'page', level: 2, x: 1, y: 1 }, cache.fallbackLevels('page', 2))
        ?.map((entry) => entry.key.level)
    ).toEqual([0.5])
  })

  test('prefers a level covering the whole area, then the nearest partial one', () => {
    const cache = new TileImageCache()
    cache.install(tileAt(2, 0, 0), 1)
    // One of four finer tiles still stands in for its quarter; the rest stays page colour.
    expect(
      cache
        .findFallback({ pageId: 'page', level: 1, x: 0, y: 0 }, cache.fallbackLevels('page', 1))
        ?.map((entry) => entry.key.x)
    ).toEqual([0])
    // A coarser level covering everything wins over a partial finer one.
    cache.install(tileAt(0.25, 0, 0), 1)
    expect(
      cache
        .findFallback({ pageId: 'page', level: 1, x: 0, y: 0 }, cache.fallbackLevels('page', 1))
        ?.map((entry) => entry.key.level)
    ).toEqual([0.25])
    cache.invalidateBounds('page', { minX: 0, minY: 0, maxX: 1024, maxY: 1024 }, 2)
    cache.install(tileAt(2, 0, 0), 2)
    cache.install(tileAt(2, 1, 0), 2)
    cache.install(tileAt(2, 0, 1), 2)
    cache.install(tileAt(2, 1, 1), 2)
    cache.install(tileAt(0.5, 0, 0), 2)
    // Both levels cover everything and sit one step away; the finer one wins the tie.
    const fallback = cache.findFallback(
      { pageId: 'page', level: 1, x: 0, y: 0 },
      cache.fallbackLevels('page', 1)
    )
    expect(fallback?.map((entry) => entry.key.level)).toEqual([2, 2, 2, 2])
  })

  test('ignores levels more than eight times finer, which would need dozens of tiles per hole', () => {
    const cache = new TileImageCache()
    cache.install(tileAt(16, 0, 0), 1)
    cache.install(tileAt(0.0625, 0, 0), 1)
    expect(cache.fallbackLevels('page', 1)).toEqual([0.0625])
    expect(cache.fallbackLevels('page', 4)).toEqual([16, 0.0625])
  })
})
