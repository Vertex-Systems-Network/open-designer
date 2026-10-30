import type { Canvas, FilterMode } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  nodeRequiresAtomicChunk,
  RenderChunkIndex,
  RenderChunkPictureCache
} from '#core/canvas/renderer/chunks'
import { rendererNow } from '#core/canvas/renderer/clock'

import { type CachedTile, TileImageCache } from './cache'
import {
  MAX_TILE_LEVEL,
  MIN_TILE_LEVEL,
  TILE_DEVICE_SIZE,
  type TileKey,
  tileLevel,
  tileWorldBounds,
  type TileWorldBounds
} from './geometry'
import { planTiles, type TilePlanOptions } from './planner'
import { childTileKeys, deleteRenderedTile, downsampleTile, renderTile, tileChunks } from './render'
import {
  emptyTileSchedulerMetrics,
  TileScheduler,
  type TileJob,
  type TileSchedulerMetrics
} from './scheduler'
import { TileSurfacePool } from './surface-pool'
import { emitTileCoverageComplete, emitTileFrameTrace } from './telemetry'

const TILE_FRAME_BUDGET_MS = 8
/** Tile work per frame while the viewport moves, leaving the rest to input and presentation. */
const NAVIGATION_TILE_BUDGET_MS = 2
/** The one tile a moving frame may still afford past its budget; dearer tiles wait for idle. */
const NAVIGATION_FIRST_TILE_LIMIT_MS = 4
/**
 * The one tile an idle frame may afford past its budget while only background stages remain,
 * so a gesture that starts then never waits long for the frame; visible tiles have no limit.
 */
const BACKGROUND_FIRST_TILE_LIMIT_MS = 6
const MAXIMUM_TILE_JOBS_PER_FRAME = 128
const TILE_OVERSCAN = 1
/** The backdrop is this many times coarser than the visible level, and reaches this far out. */
const BACKDROP_LEVEL_RATIO = 4
const BACKDROP_OVERSCAN = 1
/** How many halvings of the visible level the pyramid keeps: 2⁶ covers a 64× zoom out. */
const PYRAMID_LEVELS = 6
/** The whole page is kept at a level where its longer side spans this many tiles. */
const PAGE_BACKDROP_TILES = 4
const TILE_COST_SMOOTHING = 0.3
/** Exact levels are keyed to this many bits of the scale's logarithm: stable across float noise. */
const EXACT_LEVEL_BITS = 20

/**
 * The level a settled view renders at: the device scale itself, so tiles draw on whole device
 * pixels without resampling, rounded so a gesture that ends a few ulps from where it began
 * finds its tiles again instead of rendering them anew. Quantized levels serve the backdrop.
 */
function exactTileLevel(scale: number): number {
  const clamped = Math.min(MAX_TILE_LEVEL, Math.max(MIN_TILE_LEVEL, scale))
  return 2 ** (Math.round(Math.log2(clamped) * 2 ** EXACT_LEVEL_BITS) / 2 ** EXACT_LEVEL_BITS)
}

function smoothCost(previous: number | undefined, costMs: number): number {
  if (previous === undefined) return costMs
  return previous * (1 - TILE_COST_SMOOTHING) + costMs * TILE_COST_SMOOTHING
}

export interface TiledSceneFrameResult {
  /** Every visible tile exists at the current level. */
  covered: boolean
  /** Visible tiles are still outstanding: settlement waits for this. */
  pending: boolean
  /**
   * Work beyond the visible tiles remains, the overscan ring, the page copy, the pyramid, or
   * the backdrop ring, which only proceeds in frames, so the caller should keep scheduling them.
   */
  backgroundPending: boolean
  metrics: TileSchedulerMetrics
  /** Tiles of other levels drawn, scaled, where the current level has none yet. */
  fallbackTileCount: number
  /** Visible tile areas no level covers; they show the page colour until their tiles render. */
  uncoveredAreaCount: number
  /** Those of the uncovered areas that lie over the page's content rather than empty canvas. */
  uncoveredContentAreaCount: number
}

export interface TiledSceneControllerOptions {
  /** The clock the scheduler's deadline and the tile cost model share. */
  now?: () => number
}

interface VisiblePresentation {
  exact: Array<{ key: TileKey; tile: CachedTile }>
  fallback: Array<{ key: TileKey; tiles: CachedTile[] }>
  uncovered: number
  uncoveredContent: number
}

export class TiledSceneController {
  private readonly now: () => number
  private index: RenderChunkIndex | null = null
  private pageId: string | null = null
  private contentGeneration = -1
  private navigationGeneration = -1
  private navigationActive = false
  private cancelledJobs = 0
  private pendingInvalidations: Array<{
    nodeId: string
    previousBounds: TileWorldBounds[]
  }> = []
  private lastCoveredGeneration = ''
  private readonly pictureCache = new RenderChunkPictureCache()
  private readonly tileCache = new TileImageCache()
  private readonly surfacePool = new TileSurfacePool()
  private readonly scheduler: TileScheduler
  /** Smoothed render time of each tile already rendered, in ms. */
  private readonly measuredCosts = new Map<string, number>()
  /**
   * Smoothed render time of any tile, in ms: the estimate for a tile not rendered yet. The
   * scheduler compares estimates with its frame budget, so they must be times, not node counts.
   */
  private typicalCostMs: number | undefined

  constructor(options: TiledSceneControllerOptions = {}) {
    this.now = options.now ?? rendererNow
    this.scheduler = new TileScheduler({
      now: this.now,
      budgetMs: TILE_FRAME_BUDGET_MS,
      maximumJobsPerFrame: MAXIMUM_TILE_JOBS_PER_FRAME
    })
  }

  invalidateNode(nodeId: string, graph?: SceneGraph): void {
    const chunks = this.index?.getChunksDependingOnNode(nodeId) ?? []
    const owningChunks = this.index?.getChunksForNode(nodeId) ?? []
    const node = graph?.getNode(nodeId)
    if (
      graph &&
      node &&
      owningChunks.some((chunk) => chunk.interruptible === nodeRequiresAtomicChunk(graph, node))
    ) {
      this.invalidateStructure()
      return
    }
    this.pendingInvalidations.push({
      nodeId,
      previousBounds: chunks.map(({ minX, minY, maxX, maxY }) => ({ minX, minY, maxX, maxY }))
    })
  }

  invalidateStructure(): void {
    this.invalidate()
  }

  /**
   * Whether a frame still has tile work to do: invalidations recorded since the last frame, or
   * queued jobs. Unlike the renderer's settlement flags, this is current between frames.
   */
  hasPendingWork(): boolean {
    return this.pendingInvalidations.length > 0 || this.scheduler.pending() > 0
  }

  /**
   * Renders due tiles within the frame's budget and presents the viewport from the cache: exact
   * tiles where they exist, the nearest level's tiles scaled where they do not, and the page
   * colour where no level has one, until its tile renders. Nothing is drawn straight from the
   * scene, whose whole-page picture a large document cannot afford. Navigation keeps presenting
   * and rendering under a shorter budget, a zoom at a quantized level; the retained backing plays
   * no part. Idle time builds a pyramid of downsampled copies and a
   * scene-rendered backdrop around the viewport, so a zoom out finds scaled stand-ins.
   */
  renderFrame(
    renderer: SkiaRenderer,
    canvas: Canvas,
    graph: SceneGraph,
    contentGeneration: number,
    navigationGeneration: number
  ): TiledSceneFrameResult {
    this.navigationGeneration = navigationGeneration
    this.navigationActive = this.isNavigationActive(renderer)
    this.prepareGeneration(renderer, graph, contentGeneration, navigationGeneration)
    const viewport = {
      minX: -renderer.panX / renderer.zoom,
      minY: -renderer.panY / renderer.zoom,
      maxX: (-renderer.panX + renderer.viewportWidth) / renderer.zoom,
      maxY: (-renderer.panY + renderer.viewportHeight) / renderer.zoom
    }
    const index = this.index
    if (!index || !renderer.pageId) return this.emptyResult()

    // A zoom passes through levels too fast to render each exactly, so while it lasts tiles are
    // rendered at the quantized level just above the scale, which holds for a band of zooms and
    // scales down by at most a step; once it ends the exact level renders over them.
    const scale = renderer.zoom * renderer.dpr
    const level = renderer.navigationPhase === 'zoom' ? tileLevel(scale) : exactTileLevel(scale)
    // Jobs planned at another level draw nothing the viewport shows now; a downsample is cheap
    // and feeds the fallback at any level, so it stays.
    const backdropLevel = tileLevel((level / BACKDROP_LEVEL_RATIO) * (1 - 1e-9))
    const pageBackdrop = this.pageBackdrop(index, level)
    this.cancelledJobs += this.scheduler.discard(
      (job) =>
        job.kind !== 'downsample' &&
        job.key.level !== level &&
        job.key.level !== backdropLevel &&
        job.key.level !== pageBackdrop?.level
    )
    const zooming = renderer.navigationPhase === 'zoom'
    const planOptions: TilePlanOptions = {
      pageId: renderer.pageId,
      level,
      viewport,
      overscanTiles: TILE_OVERSCAN,
      navigationGeneration,
      contentGeneration,
      estimateCost: (key) => this.estimateCost(renderer, index, key, zooming),
      globalFallbackAvailable: true,
      // Background stages wait for idle: a moving frame has only its budget to give.
      ...(this.navigationActive
        ? {}
        : {
            backdrop: { level: backdropLevel, overscanTiles: BACKDROP_OVERSCAN },
            pageBackdrop,
            pyramid: { levels: PYRAMID_LEVELS }
          })
    }
    const plan = planTiles(this.tileCache, planOptions)
    this.scheduler.enqueue(plan.jobs)
    const visibleOutstanding = plan.visible.some(
      ({ tile }) => tile?.contentGeneration !== contentGeneration
    )
    const firstJobLimitMs = this.firstJobLimit(visibleOutstanding)
    const metrics = this.scheduler.runFrame(
      (job, remainingMs) => this.executeJob(renderer, graph, index, job, remainingMs),
      this.navigationActive ? NAVIGATION_TILE_BUDGET_MS : TILE_FRAME_BUDGET_MS,
      firstJobLimitMs
    )
    metrics.cancelledJobs += this.cancelledJobs
    this.cancelledJobs = 0
    // A stage is planned only once the previous one is done, so the plan is taken again after
    // the frame's work to learn whether anything remains for the next frame, and to queue it.
    // While moving, only the visible tiles are planned, and the frame does not re-plan.
    const next = this.navigationActive ? plan : planTiles(this.tileCache, planOptions)
    if (!this.navigationActive) this.scheduler.enqueue(next.jobs)

    const visible = planTiles(
      this.tileCache,
      {
        pageId: renderer.pageId,
        level,
        viewport,
        overscanTiles: 0,
        navigationGeneration,
        contentGeneration,
        estimateCost: () => 0
      },
      true
    ).visible
    const presentation = this.resolveVisible(visible, renderer.pageId, level, index.bounds())
    canvas.save()
    // Snapped to device pixels, an exact tile lands texel on pixel and copies rather than samples.
    canvas.translate(
      Math.round(renderer.panX * renderer.dpr) / renderer.dpr,
      Math.round(renderer.panY * renderer.dpr) / renderer.dpr
    )
    canvas.scale(renderer.zoom, renderer.zoom)
    this.drawPresentation(renderer, canvas, presentation)
    canvas.restore()

    const covered = presentation.exact.length === visible.length
    emitTileFrameTrace({
      contentGeneration,
      metrics,
      tileCacheBytes: this.tileCache.byteSize(),
      tileCacheEntries: this.tileCache.size(),
      visibleTileCount: visible.length,
      presentedTileCount: presentation.exact.length,
      fallbackTileCount: presentation.fallback.length,
      uncoveredAreaCount: presentation.uncovered,
      uncoveredContentAreaCount: presentation.uncoveredContent,
      covered
    })
    const settledGenerationKey = `${navigationGeneration}:${contentGeneration}`
    if (covered && !this.navigationActive && this.lastCoveredGeneration !== settledGenerationKey) {
      this.lastCoveredGeneration = settledGenerationKey
      emitTileCoverageComplete(
        level,
        contentGeneration,
        navigationGeneration,
        this.tileCache.size(),
        this.tileCache.byteSize()
      )
    }
    const visiblePending = next.visible.some(
      ({ tile }) => tile?.contentGeneration !== contentGeneration
    )
    return {
      covered,
      pending: visiblePending || !covered,
      backgroundPending: !this.navigationActive && this.scheduler.pending() > 0,
      metrics,
      fallbackTileCount: presentation.fallback.length,
      uncoveredAreaCount: presentation.uncovered,
      uncoveredContentAreaCount: presentation.uncoveredContent
    }
  }

  invalidate(): void {
    this.cancelledJobs += this.scheduler.clear()
    this.index?.dispose()
    this.index = null
    this.pageId = null
    this.contentGeneration = -1
    this.lastCoveredGeneration = ''
    this.pendingInvalidations = []
    this.measuredCosts.clear()
    this.pictureCache.clear()
    this.tileCache.clear()
  }

  destroy(): void {
    this.invalidate()
    this.cancelledJobs = 0
    this.navigationGeneration = -1
    this.navigationActive = false
    this.typicalCostMs = undefined
    this.surfacePool.clear()
  }

  private isNavigationActive(renderer: SkiaRenderer): boolean {
    return (
      renderer.navigationPhase === 'pan' ||
      renderer.navigationPhase === 'zoom' ||
      renderer.navigationPhase === 'momentum' ||
      renderer.navigationPhase === 'settling'
    )
  }

  private prepareGeneration(
    renderer: SkiaRenderer,
    graph: SceneGraph,
    contentGeneration: number,
    navigationGeneration: number
  ): void {
    this.cancelledJobs += this.scheduler.setGeneration(navigationGeneration, contentGeneration)
    // Node changes arrive through invalidateNode() and structural ones through
    // invalidateStructure(), so a new content generation on its own is a redraw request (every
    // requestRender() bumps it) and the rendered tiles stay valid. Invalidations also arrive
    // without a new generation, as when an image preview decodes.
    if (
      this.index &&
      this.pageId === renderer.pageId &&
      (this.contentGeneration !== contentGeneration || this.pendingInvalidations.length > 0)
    ) {
      this.applyPendingInvalidations(graph, contentGeneration)
    }
    if (this.index && this.pageId !== renderer.pageId) this.invalidate()
    // Without an index nothing can be shown, so a page that arrives mid-gesture builds its index
    // at once; its tiles then fill in under the moving budget rather than after the gesture.
    if (this.index === null && renderer.pageId) {
      this.ensureIndex(graph, renderer.pageId, contentGeneration)
    }
  }

  private applyPendingInvalidations(graph: SceneGraph, contentGeneration: number): void {
    const index = this.index
    if (!index || !this.pageId) return
    this.tileCache.advanceGeneration(contentGeneration)
    for (const invalidation of this.pendingInvalidations) {
      const before = invalidation.previousBounds
      const chunks = index.getChunksDependingOnNode(invalidation.nodeId)
      for (const chunk of chunks) this.pictureCache.invalidate(chunk.id)
      for (const chunk of chunks) index.updateNode(graph, chunk.nodeId)
      const after = index.getChunksDependingOnNode(invalidation.nodeId)
      for (const bounds of [...before, ...after]) {
        this.tileCache.invalidateBounds(this.pageId, bounds, contentGeneration)
      }
    }
    this.pendingInvalidations = []
    this.contentGeneration = contentGeneration
  }

  private ensureIndex(graph: SceneGraph, pageId: string | null, contentGeneration: number): void {
    if (this.index && this.pageId === pageId && this.contentGeneration === contentGeneration) return
    this.index?.dispose()
    this.pictureCache.clear()
    this.tileCache.markStale(contentGeneration)
    this.pageId = pageId
    this.contentGeneration = contentGeneration
    // A fresh index already reflects every change recorded before it was built.
    this.pendingInvalidations = []
    this.index = pageId ? RenderChunkIndex.build(graph, pageId).index : null
  }

  /** How far past its budget a frame's first job may run. */
  private firstJobLimit(visibleOutstanding: boolean): number {
    if (this.navigationActive) return NAVIGATION_FIRST_TILE_LIMIT_MS
    if (visibleOutstanding) return Number.POSITIVE_INFINITY
    return BACKGROUND_FIRST_TILE_LIMIT_MS
  }

  /**
   * A tile over nothing is free; while zooming, a tile with a chunk picture still to record is
   * beyond any frame, since recording cannot be bounded below one chunk; otherwise the tile's
   * own smoothed cost, or that of any tile until it has been measured.
   */
  private estimateCost(
    renderer: SkiaRenderer,
    index: RenderChunkIndex,
    key: TileKey,
    zooming: boolean
  ): number {
    const chunks = tileChunks(index, key)
    if (chunks.length === 0) return 0
    if (
      zooming &&
      chunks.some(
        (chunk) =>
          (chunk.kind !== 'subtree' || chunk.interruptible) &&
          !this.pictureCache.has(renderer, chunk)
      )
    ) {
      return Number.POSITIVE_INFINITY
    }
    return this.measuredCosts.get(this.costKey(key)) ?? this.typicalCostMs ?? 0
  }

  /**
   * Recording a chunk's picture is the dear part of a tile, so a tile whose chunks are not all
   * recorded yet records them until the frame's budget is spent and defers the rest; the tile
   * itself renders, from recorded pictures, on the frame that finds them all present.
   */
  private recordChunkPictures(
    renderer: SkiaRenderer,
    graph: SceneGraph,
    index: RenderChunkIndex,
    key: TileKey,
    remainingMs: number
  ): boolean {
    const deadline = this.now() + remainingMs
    let recorded = 0
    for (const chunk of tileChunks(index, key)) {
      if (chunk.kind === 'subtree' && !chunk.interruptible) continue
      if (this.pictureCache.has(renderer, chunk)) continue
      if (recorded > 0 && this.now() >= deadline) return false
      this.pictureCache.get(renderer, graph, chunk)
      recorded++
    }
    return true
  }

  private executeJob(
    renderer: SkiaRenderer,
    graph: SceneGraph,
    index: RenderChunkIndex,
    job: TileJob,
    remainingMs: number
  ) {
    const startedAt = this.now()
    if (
      job.kind !== 'downsample' &&
      !this.recordChunkPictures(renderer, graph, index, job.key, remainingMs)
    ) {
      return { renderMs: this.now() - startedAt, overBudget: false, deferred: true }
    }
    const tile =
      job.kind === 'downsample'
        ? this.downsample(renderer, job)
        : renderTile(renderer, graph, index, job.key, this.pictureCache, this.surfacePool)
    if (!tile) return { renderMs: 0, overBudget: job.kind !== 'downsample' }
    if (job.kind !== 'downsample') this.recordCost(job.key, this.now() - startedAt)
    if (
      job.navigationGeneration !== this.navigationGeneration ||
      job.contentGeneration !== this.contentGeneration
    ) {
      deleteRenderedTile(tile)
      return this.jobResult(tile)
    }
    this.tileCache.install(tile, job.contentGeneration)
    return this.jobResult(tile)
  }

  /** Null when a child has gone since the job was planned; the next plan decides again. */
  private downsample(renderer: SkiaRenderer, job: TileJob) {
    const children: CachedTile[] = []
    for (const childKey of childTileKeys(job.key)) {
      const child = this.tileCache.getIfPresent(childKey)
      if (!child || child.contentGeneration !== job.contentGeneration) return null
      children.push(child)
    }
    return downsampleTile(renderer, job.key, children, this.surfacePool)
  }

  /**
   * The whole page at a level coarse enough to fit PAGE_BACKDROP_TILES along its longer side,
   * or undefined when the visible level is already that coarse. The level depends only on the
   * page, so its tiles stay valid across zooms.
   */
  private pageBackdrop(
    index: RenderChunkIndex,
    level: number
  ): { level: number; bounds: TileWorldBounds } | undefined {
    const bounds = index.bounds()
    if (!bounds) return undefined
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1)
    const pageLevel = Math.max(
      MIN_TILE_LEVEL,
      tileLevel((PAGE_BACKDROP_TILES * TILE_DEVICE_SIZE) / span)
    )
    if (pageLevel >= level) return undefined
    return { level: pageLevel, bounds }
  }

  /** Whether the cache holds a fresh tile for `key`. */
  isRendered(key: TileKey): boolean {
    return this.tileCache.getIfPresent(key)?.contentGeneration === this.contentGeneration
  }

  private jobResult(tile: NonNullable<ReturnType<typeof renderTile>>) {
    return {
      renderMs: tile.renderMs,
      overBudget: tile.renderMs > TILE_FRAME_BUDGET_MS,
      allocationMs: tile.allocationMs,
      drawMs: tile.drawMs,
      flushMs: tile.flushMs,
      snapshotMs: tile.snapshotMs,
      chunkCount: tile.chunkCount
    }
  }

  private recordCost(key: TileKey, costMs: number): void {
    const id = this.costKey(key)
    this.measuredCosts.set(id, smoothCost(this.measuredCosts.get(id), costMs))
    this.typicalCostMs = smoothCost(this.typicalCostMs, costMs)
  }

  private costKey(key: TileKey): string {
    return `${key.level}:${key.x}:${key.y}`
  }

  private resolveVisible(
    visible: Array<{ key: TileKey; tile: CachedTile | null }>,
    pageId: string,
    level: number,
    content: TileWorldBounds | null
  ): VisiblePresentation {
    const presentation: VisiblePresentation = {
      exact: [],
      fallback: [],
      uncovered: 0,
      uncoveredContent: 0
    }
    let levels: number[] | undefined
    for (const { key, tile } of visible) {
      if (tile) {
        presentation.exact.push({ key, tile })
        continue
      }
      levels ??= this.tileCache.fallbackLevels(pageId, level)
      const tiles = this.tileCache.findFallback(key, levels)
      if (tiles) {
        presentation.fallback.push({ key, tiles })
        continue
      }
      presentation.uncovered++
      const bounds = tileWorldBounds(key)
      if (
        content &&
        bounds.minX < content.maxX &&
        bounds.maxX > content.minX &&
        bounds.minY < content.maxY &&
        bounds.maxY > content.minY
      ) {
        presentation.uncoveredContent++
      }
    }
    return presentation
  }

  /** Draws tiles in world space; the canvas already carries the viewport transform. */
  private drawPresentation(
    renderer: SkiaRenderer,
    canvas: Canvas,
    presentation: VisiblePresentation
  ): void {
    const paint = renderer.opacityPaint
    paint.setAlphaf(1)
    paint.setBlendMode(renderer.ck.BlendMode.Src)
    const source = renderer.ck.LTRBRect(0, 0, TILE_DEVICE_SIZE, TILE_DEVICE_SIZE)
    const drawTile = (tile: CachedTile, filter: FilterMode) => {
      if (!tile.image) return
      const bounds = tileWorldBounds(tile.key)
      canvas.drawImageRectOptions(
        tile.image,
        source,
        renderer.ck.LTRBRect(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY),
        filter,
        renderer.ck.MipmapMode.None,
        paint
      )
    }
    try {
      for (const { tiles, key } of presentation.fallback) {
        const bounds = tileWorldBounds(key)
        canvas.save()
        canvas.clipRect(
          renderer.ck.LTRBRect(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY),
          renderer.ck.ClipOp.Intersect,
          false
        )
        for (const tile of tiles) drawTile(tile, renderer.ck.FilterMode.Linear)
        canvas.restore()
      }
      // An exact tile sits texel on pixel; nearest sampling copies it, so float noise in the
      // viewport can never shift a value at a seam.
      for (const { tile } of presentation.exact) drawTile(tile, renderer.ck.FilterMode.Nearest)
    } finally {
      paint.setBlendMode(renderer.ck.BlendMode.SrcOver)
    }
  }

  private emptyResult(): TiledSceneFrameResult {
    return {
      covered: false,
      pending: false,
      backgroundPending: false,
      metrics: emptyTileSchedulerMetrics(),
      fallbackTileCount: 0,
      uncoveredAreaCount: 1,
      uncoveredContentAreaCount: 1
    }
  }
}
