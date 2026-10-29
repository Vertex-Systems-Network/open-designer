import type { Canvas } from 'canvaskit-wasm'

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
  TILE_DEVICE_SIZE,
  type TileKey,
  tileLevel,
  tileWorldBounds,
  type TileWorldBounds
} from './geometry'
import { planTiles } from './planner'
import { deleteRenderedTile, renderTile } from './render'
import {
  emptyTileSchedulerMetrics,
  TileScheduler,
  type TileJob,
  type TileSchedulerMetrics
} from './scheduler'
import { TileSurfacePool } from './surface-pool'
import { emitTileCoverageComplete, emitTileFrameTrace } from './telemetry'

const TILE_FRAME_BUDGET_MS = 5
/** Tile work per frame while the viewport moves, leaving the rest to input and presentation. */
const NAVIGATION_TILE_BUDGET_MS = 2
/** The one tile a moving frame may still afford past its budget; dearer tiles wait for idle. */
const NAVIGATION_FIRST_TILE_LIMIT_MS = 8
const MAXIMUM_TILE_JOBS_PER_FRAME = 128
const TILE_OVERSCAN = 1
/** The backdrop is this many times coarser than the visible level, and reaches this far out. */
const BACKDROP_LEVEL_RATIO = 4
const BACKDROP_OVERSCAN = 1
const TILE_COST_SMOOTHING = 0.3

function smoothCost(previous: number | undefined, costMs: number): number {
  if (previous === undefined) return costMs
  return previous * (1 - TILE_COST_SMOOTHING) + costMs * TILE_COST_SMOOTHING
}

export interface TiledSceneFrameResult {
  /** Every visible tile exists at the current level. */
  covered: boolean
  pending: boolean
  metrics: TileSchedulerMetrics
  /** Tiles of other levels drawn, scaled, where the current level has none yet. */
  fallbackTileCount: number
  /** Visible tile areas no level covers; they show the page colour until their tiles render. */
  uncoveredAreaCount: number
}

export interface TiledSceneControllerOptions {
  /** The clock the scheduler's deadline and the tile cost model share. */
  now?: () => number
}

interface VisiblePresentation {
  exact: Array<{ key: TileKey; tile: CachedTile }>
  fallback: Array<{ key: TileKey; tiles: CachedTile[] }>
  uncovered: number
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
   * Renders due tiles within the frame's budget and presents the viewport from the cache: exact
   * tiles where they exist, the nearest level's tiles scaled where they do not, and the page
   * colour where no level has one, until its tile renders. Nothing is drawn straight from the
   * scene, whose whole-page picture a large document cannot afford. Navigation keeps presenting,
   * shortens the budget while panning, and rasterizes nothing while zooming; the retained
   * backing plays no part.
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

    const level = tileLevel(renderer.zoom * renderer.dpr)
    // Jobs planned at another level draw nothing the viewport shows now.
    const backdropLevel = tileLevel((level / BACKDROP_LEVEL_RATIO) * (1 - 1e-9))
    this.cancelledJobs += this.scheduler.discard(
      (job) => job.key.level !== level && job.key.level !== backdropLevel
    )
    const plan = planTiles(this.tileCache, {
      pageId: renderer.pageId,
      level,
      viewport,
      overscanTiles: TILE_OVERSCAN,
      navigationGeneration,
      contentGeneration,
      estimateCost: (key) => this.measuredCosts.get(this.costKey(key)) ?? this.typicalCostMs ?? 0,
      globalFallbackAvailable: true,
      backdrop: { level: backdropLevel, overscanTiles: BACKDROP_OVERSCAN }
    })
    // A zoom changes level every few frames, and rasterizing each level as it passes costs more
    // GPU time than the gesture leaves; the previous level's tiles stand in until the zoom ends.
    // A pan keeps its level, so its newly exposed tiles fill in under the navigation budget.
    let metrics: TileSchedulerMetrics
    if (renderer.navigationPhase === 'zoom') {
      metrics = emptyTileSchedulerMetrics()
      metrics.remaining = plan.jobs.length
      metrics.skippedWithFallback = plan.jobs.filter((job) => job.fallbackAvailable).length
    } else {
      this.scheduler.enqueue(plan.jobs)
      metrics = this.scheduler.runFrame(
        (job) => this.executeJob(renderer, graph, index, job),
        this.navigationActive ? NAVIGATION_TILE_BUDGET_MS : TILE_FRAME_BUDGET_MS,
        this.navigationActive ? NAVIGATION_FIRST_TILE_LIMIT_MS : Number.POSITIVE_INFINITY
      )
    }
    metrics.cancelledJobs += this.cancelledJobs
    this.cancelledJobs = 0

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
    const presentation = this.resolveVisible(visible)
    canvas.save()
    canvas.translate(renderer.panX, renderer.panY)
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
    return {
      covered,
      pending: this.scheduler.pending() > 0 || !covered,
      metrics,
      fallbackTileCount: presentation.fallback.length,
      uncoveredAreaCount: presentation.uncovered
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

  private executeJob(
    renderer: SkiaRenderer,
    graph: SceneGraph,
    index: RenderChunkIndex,
    job: TileJob
  ) {
    const startedAt = this.now()
    const tile = renderTile(renderer, graph, index, job.key, this.pictureCache, this.surfacePool)
    if (!tile) return { renderMs: 0, overBudget: true }
    this.recordCost(job.key, this.now() - startedAt)
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
    visible: Array<{ key: TileKey; tile: CachedTile | null }>
  ): VisiblePresentation {
    const presentation: VisiblePresentation = { exact: [], fallback: [], uncovered: 0 }
    for (const { key, tile } of visible) {
      if (tile) {
        presentation.exact.push({ key, tile })
        continue
      }
      const tiles = this.tileCache.findFallback(key)
      if (tiles) presentation.fallback.push({ key, tiles })
      else presentation.uncovered++
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
    const drawTile = (tile: CachedTile) => {
      const bounds = tileWorldBounds(tile.key)
      canvas.drawImageRectOptions(
        tile.image,
        source,
        renderer.ck.LTRBRect(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY),
        renderer.ck.FilterMode.Linear,
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
        for (const tile of tiles) drawTile(tile)
        canvas.restore()
      }
      for (const { tile } of presentation.exact) drawTile(tile)
    } finally {
      paint.setBlendMode(renderer.ck.BlendMode.SrcOver)
    }
  }

  private emptyResult(): TiledSceneFrameResult {
    return {
      covered: false,
      pending: false,
      metrics: emptyTileSchedulerMetrics(),
      fallbackTileCount: 0,
      uncoveredAreaCount: 1
    }
  }
}
