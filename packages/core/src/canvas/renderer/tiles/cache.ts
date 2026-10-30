import type { Image as CKImage } from 'canvaskit-wasm'

import { ResourceCache } from '#core/cache/resource'

import {
  tileKeysForWorldBounds,
  tileKeyString,
  tileWorldBounds,
  tileWorldSize,
  type TileKey,
  type TileWorldBounds
} from './geometry'
import type { RenderedTile } from './render'

export interface CachedTile {
  key: TileKey
  image: CKImage
  contentGeneration: number
  lastUsed: number
  bytes: number
}

const DEFAULT_MAX_TILE_BYTES = 128 * 1024 * 1024

/** Levels are compared by zoom distance; a finer level wins a tie, as it stays sharp scaled down. */
function compareLevelDistance(target: number) {
  return (a: number, b: number) =>
    Math.abs(Math.log2(a / target)) - Math.abs(Math.log2(b / target)) || b - a
}

/**
 * A finer level stands in for a missing tile with (ratio)² of its own, so the ratio is capped:
 * past it the lookup would enumerate thousands of keys per tile on every frame of a zoom out.
 * A coarser level always covers a tile with at most four.
 */
const MAX_FINER_FALLBACK_RATIO = 8

export class TileImageCache {
  private readonly entries: ResourceCache<string, CachedTile>
  /** How many tiles each page holds per level, so fallback lookups try only populated levels. */
  private readonly levelCounts = new Map<string, Map<number, number>>()
  private clock = 0

  constructor(maxBytes = DEFAULT_MAX_TILE_BYTES) {
    this.entries = new ResourceCache({
      maxWeight: maxBytes,
      weight: (entry) => entry.bytes,
      dispose: (entry) => {
        this.countLevel(entry.key, -1)
        entry.image.delete()
      }
    })
  }

  private countLevel(key: TileKey, delta: number): void {
    const levels = this.levelCounts.get(key.pageId) ?? new Map<number, number>()
    const count = (levels.get(key.level) ?? 0) + delta
    if (count > 0) levels.set(key.level, count)
    else levels.delete(key.level)
    if (levels.size > 0) this.levelCounts.set(key.pageId, levels)
    else this.levelCounts.delete(key.pageId)
  }

  /**
   * Cached tiles of other levels that stand in for `key`'s missing tile, scaled: the nearest
   * level whose tiles cover all of its area, else the nearest level that has any tile over it,
   * which leaves the rest at the page colour. Null when no level has a tile there.
   */
  /** The levels `findFallback` may draw from for a page shown at `level`, nearest first. */
  fallbackLevels(pageId: string, level: number): number[] {
    return [...(this.levelCounts.get(pageId)?.keys() ?? [])]
      .filter((candidate) => candidate < level || candidate / level <= MAX_FINER_FALLBACK_RATIO)
      .filter((candidate) => candidate !== level)
      .sort(compareLevelDistance(level))
  }

  findFallback(key: TileKey, levels: number[]): CachedTile[] | null {
    const bounds = tileWorldBounds(key)
    // Shrink by a hair so a boundary shared with the next tile does not ask for that tile too.
    const inset = {
      minX: bounds.minX + 1e-6,
      minY: bounds.minY + 1e-6,
      maxX: bounds.maxX - 1e-6,
      maxY: bounds.maxY - 1e-6
    }
    let partial: CachedTile[] | null = null
    for (const level of levels) {
      const tiles: CachedTile[] = []
      let complete = true
      for (const candidate of tileKeysForWorldBounds(key.pageId, level, inset)) {
        const tile = this.get(candidate)
        if (tile) tiles.push(tile)
        else complete = false
      }
      if (tiles.length === 0) continue
      if (complete) return tiles
      partial ??= tiles
    }
    return partial
  }

  get(key: TileKey): CachedTile | null {
    const id = tileKeyString(key)
    const entry = this.entries.get(id)
    if (!entry) return null
    entry.lastUsed = ++this.clock
    return entry
  }

  getIfPresent(key: TileKey): CachedTile | null {
    return this.entries.peek(tileKeyString(key)) ?? null
  }

  install(tile: RenderedTile, contentGeneration: number): CachedTile | null {
    const id = tileKeyString(tile.key)
    const entry: CachedTile = {
      key: tile.key,
      image: tile.image,
      contentGeneration,
      lastUsed: ++this.clock,
      bytes: tile.image.width() * tile.image.height() * 4
    }
    if (!this.entries.set(id, entry)) {
      entry.image.delete()
      return null
    }
    this.countLevel(tile.key, 1)
    return entry
  }

  markStale(contentGeneration: number): void {
    for (const entry of this.entries.values()) {
      if (entry.contentGeneration >= contentGeneration)
        entry.contentGeneration = contentGeneration - 1
    }
  }

  invalidateBounds(pageId: string, bounds: TileWorldBounds, contentGeneration: number): number {
    let invalidated = 0
    for (const [id, entry] of this.entries) {
      if (entry.key.pageId !== pageId) continue
      const size = tileWorldSize(entry.key.level)
      const minX = entry.key.x * size
      const minY = entry.key.y * size
      if (
        minX >= bounds.maxX ||
        minY >= bounds.maxY ||
        minX + size <= bounds.minX ||
        minY + size <= bounds.minY
      ) {
        entry.contentGeneration = contentGeneration
        continue
      }
      this.entries.delete(id)
      invalidated++
    }
    return invalidated
  }

  advanceGeneration(contentGeneration: number): void {
    for (const entry of this.entries.values()) entry.contentGeneration = contentGeneration
  }

  clear(): void {
    this.entries.clear()
  }

  size(): number {
    return this.entries.size
  }

  byteSize(): number {
    return this.entries.weight
  }
}
