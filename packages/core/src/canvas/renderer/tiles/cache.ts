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
   * Cached tiles of the level nearest to `key`'s that together cover its area, or null when no
   * other level covers all of it. They stand in for the missing tile, scaled, until it is rendered.
   */
  findFallback(key: TileKey): CachedTile[] | null {
    const levels = [...(this.levelCounts.get(key.pageId)?.keys() ?? [])]
      .filter((level) => level !== key.level)
      .sort(compareLevelDistance(key.level))
    const bounds = tileWorldBounds(key)
    // Shrink by a hair so a boundary shared with the next tile does not ask for that tile too.
    const inset = {
      minX: bounds.minX + 1e-6,
      minY: bounds.minY + 1e-6,
      maxX: bounds.maxX - 1e-6,
      maxY: bounds.maxY - 1e-6
    }
    for (const level of levels) {
      const tiles: CachedTile[] = []
      for (const candidate of tileKeysForWorldBounds(key.pageId, level, inset)) {
        const tile = this.get(candidate)
        if (!tile) {
          tiles.length = 0
          break
        }
        tiles.push(tile)
      }
      if (tiles.length > 0) return tiles
    }
    return null
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
