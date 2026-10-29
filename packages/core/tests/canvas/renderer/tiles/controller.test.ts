import { beforeAll, describe, expect, mock, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { initCanvasKit } from '@open-pencil/core/io/formats/raster'
import { SceneGraph } from '@open-pencil/scene-graph'

import { SkiaRenderer } from '#core/canvas'
import type { ImagePreview, ImagePreviewDecoder } from '#core/canvas/images/previews'
import { TiledSceneController } from '#core/canvas/renderer/tiles'

let ck: Awaited<ReturnType<typeof initCanvasKit>>

beforeAll(async () => {
  ck = await initCanvasKit()
})

function color(r: number, g: number, b: number) {
  return [{ type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true }]
}

describe('tile scheduling', () => {
  function createGridScene() {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'page')
    for (let index = 0; index < 48; index++) {
      graph.createNode('RECTANGLE', page.id, {
        x: (index % 12) * 100,
        y: Math.floor(index / 12) * 100,
        width: 80,
        height: 80,
        fills: color(0.2, 0.4, 0.8)
      })
    }
    const surface = expectDefined(ck.MakeSurface(1280, 800), 'scheduling surface')
    const renderer = new SkiaRenderer(ck, surface)
    renderer.pageId = page.id
    renderer.pageColor = { r: 1, g: 1, b: 1, a: 1 }
    renderer.viewportWidth = 1280
    renderer.viewportHeight = 800
    renderer.dpr = 1
    renderer.zoom = 1
    renderer.navigationPhase = 'idle'
    return { graph, surface, renderer }
  }

  test('fills the frame budget with tiles whose cost is not measured yet', () => {
    const { graph, surface, renderer } = createGridScene()
    // A clock that never advances: every tile is free, so only the cost model can stop the frame.
    const controller = new TiledSceneController({ now: () => 0 })
    try {
      const first = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      expect(first.covered).toBe(true)
      expect(first.metrics.interruptibleCompleted).toBeGreaterThan(1)
      expect(first.metrics.skippedWithFallback).toBe(0)
    } finally {
      controller.destroy()
      renderer.destroy()
    }
  })

  test('keeps rendered tiles when the content generation advances without node changes', () => {
    const { graph, surface, renderer } = createGridScene()
    const controller = new TiledSceneController({ now: () => 0 })
    try {
      let result = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      for (let frame = 0; frame < 10 && result.pending; frame++) {
        result = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      }
      expect(result.covered).toBe(true)
      // Overscan and then the backdrop are planned once the visible tiles exist; a free clock
      // finishes each stage in one frame, so a frame with no work means everything is rendered.
      let settled = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      for (let frame = 0; frame < 5 && settled.metrics.interruptibleCompleted > 0; frame++) {
        settled = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      }
      expect(settled.metrics.interruptibleCompleted).toBe(0)

      // requestRender() bumps the content generation without any node changing.
      const redraw = controller.renderFrame(renderer, surface.getCanvas(), graph, 2, 0)
      expect(redraw.covered).toBe(true)
      expect(redraw.pending).toBe(false)
      expect(redraw.metrics.interruptibleCompleted).toBe(0)
      expect(redraw.metrics.mandatoryCompleted).toBe(0)
      expect(redraw.metrics.cancelledJobs).toBe(0)
    } finally {
      controller.destroy()
      renderer.destroy()
    }
  })

  test('zooms over the previous level scaled and rasterizes the new level once idle', () => {
    const { graph, surface, renderer } = createGridScene()
    const controller = new TiledSceneController({ now: () => 0 })
    try {
      let result = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      for (let frame = 0; frame < 10 && result.pending; frame++) {
        result = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      }
      expect(result.covered).toBe(true)

      // Zoom in: level 2 has no tiles, and each of its tiles lies inside one level-1 tile.
      renderer.zoom = 2
      renderer.navigationPhase = 'zoom'
      const zoomed = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 1)
      expect(zoomed.covered).toBe(false)
      expect(zoomed.metrics.interruptibleCompleted).toBe(0)
      expect(zoomed.metrics.skippedWithFallback).toBeGreaterThan(0)
      expect(zoomed.fallbackTileCount).toBe(5 * 4)
      expect(zoomed.uncoveredAreaCount).toBe(0)
      expect(zoomed.pending).toBe(true)

      renderer.navigationPhase = 'idle'
      const settled = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 1)
      expect(settled.covered).toBe(true)
      expect(settled.fallbackTileCount).toBe(0)
    } finally {
      controller.destroy()
      renderer.destroy()
    }
  })

  test('renders one affordable tile per moving frame', () => {
    const { graph, surface, renderer } = createGridScene()
    // Every clock reading is 3 ms later: a tile costs 3 ms, over the moving budget but affordable.
    let time = 0
    const controller = new TiledSceneController({ now: () => (time += 3) })
    try {
      controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      renderer.navigationPhase = 'pan'
      const panning = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 1)
      expect(panning.metrics.interruptibleCompleted).toBe(1)
      expect(panning.metrics.skippedWithFallback).toBe(0)
    } finally {
      controller.destroy()
      renderer.destroy()
    }
  })

  test('zooms out over the coarse backdrop rendered around the settled viewport', () => {
    const { graph, surface, renderer } = createGridScene()
    const controller = new TiledSceneController({ now: () => 0 })
    try {
      // A free clock settles visible, overscan, and backdrop tiles within a few frames.
      let result = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      for (let frame = 0; frame < 10; frame++) {
        result = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      }
      expect(result.covered).toBe(true)
      expect(result.pending).toBe(false)

      // Zoom out to half: the visible level has nothing beyond the old viewport, the backdrop has.
      renderer.zoom = 0.5
      renderer.navigationPhase = 'zoom'
      const zoomed = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 1)
      expect(zoomed.covered).toBe(false)
      expect(zoomed.uncoveredAreaCount).toBe(0)
      expect(zoomed.fallbackTileCount).toBeGreaterThan(0)
    } finally {
      controller.destroy()
      renderer.destroy()
    }
  })

  test('counts areas no level covers and keeps a moving frame within its budget', () => {
    const { graph, surface, renderer } = createGridScene()
    let time = 0
    const controller = new TiledSceneController({ now: () => (time += 10) })
    try {
      // Idle, the first job may overrun the budget so the frame makes progress.
      const idle = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 0)
      const visibleTiles = 5 * 4
      expect(idle.metrics.interruptibleCompleted).toBe(1)
      expect(idle.uncoveredAreaCount).toBe(visibleTiles - 1)

      // Panning, a job estimated over the budget is skipped and the holes stay page colour.
      renderer.navigationPhase = 'pan'
      const panning = controller.renderFrame(renderer, surface.getCanvas(), graph, 1, 1)
      expect(panning.metrics.interruptibleCompleted).toBe(0)
      // Every queued tile is too dear, and each is tried before the frame gives up.
      expect(panning.metrics.skippedWithFallback).toBe(visibleTiles - 1)
      expect(panning.fallbackTileCount).toBe(0)
      expect(panning.uncoveredAreaCount).toBe(visibleTiles - 1)
      expect(panning.pending).toBe(true)
    } finally {
      controller.destroy()
      renderer.destroy()
    }
  })
})

describe('tiles with image previews', () => {
  function encodedSquare(r: number, g: number, b: number): Uint8Array {
    const surface = expectDefined(ck.MakeSurface(8, 8), 'image surface')
    surface.getCanvas().clear(ck.Color4f(r, g, b, 1))
    surface.flush()
    const image = surface.makeImageSnapshot()
    const bytes = expectDefined(image.encodeToBytes(ck.ImageFormat.PNG, 100), 'image PNG')
    image.delete()
    surface.delete()
    return bytes
  }

  function centerPixel(renderer: SkiaRenderer): number[] {
    const surface = renderer.surface
    surface.flush()
    const image = surface.makeImageSnapshot()
    const pixels = expectDefined(
      image.readPixels(160, 120, {
        width: 1,
        height: 1,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB
      }),
      'pixel'
    )
    image.delete()
    return Array.from(pixels as Uint8Array)
  }

  test('redraws only the tiles of an image once its preview decodes', async () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'page')
    const hash = 'red-square'
    graph.images.set(hash, encodedSquare(1, 0, 0))
    const node = graph.createNode('RECTANGLE', page.id, {
      x: 60,
      y: 40,
      width: 200,
      height: 160,
      fills: [
        {
          type: 'IMAGE',
          imageHash: hash,
          color: { r: 0, g: 0, b: 0, a: 1 },
          visible: true,
          opacity: 1
        }
      ]
    })
    graph.createNode('RECTANGLE', page.id, {
      x: 1000,
      y: 1000,
      width: 40,
      height: 40,
      fills: color(0, 0, 1)
    })
    const surface = expectDefined(ck.MakeSurface(320, 240), 'preview surface')
    const renderer = new SkiaRenderer(ck, surface)
    const controller = renderer.tiledScene
    renderer.tiledSceneEnabled = true
    renderer.pageId = page.id
    renderer.pageColor = { r: 1, g: 1, b: 1, a: 1 }
    renderer.viewportWidth = 320
    renderer.viewportHeight = 240
    renderer.dpr = 1
    renderer.zoom = 1
    renderer.navigationPhase = 'idle'
    renderer.viewportImageRendering = true
    renderer.imageMemoryGraph = graph
    let release: (() => void) | undefined
    const decoded = new Promise<void>((resolve) => {
      release = resolve
    })
    const decoder: ImagePreviewDecoder = {
      decode: async (source, edge): Promise<ImagePreview> => {
        await decoded
        return { bytes: new Uint8Array(source), originalWidth: edge, originalHeight: edge }
      },
      destroy: mock()
    }
    renderer.imagePreviews.setDecoder(decoder)
    const ready: string[] = []
    renderer.onImagePreviewReady = (readyHash) => ready.push(readyHash)
    try {
      const canvas = surface.getCanvas()
      canvas.clear(ck.WHITE)
      let result = controller.renderFrame(renderer, canvas, graph, 1, 0)
      for (let frame = 0; frame < 10 && result.pending; frame++) {
        result = controller.renderFrame(renderer, canvas, graph, 1, 0)
      }
      expect(result.covered).toBe(true)
      // The preview is still decoding, so the image draws nothing yet.
      expect(centerPixel(renderer)).toEqual([255, 255, 255, 255])
      expect(renderer.imageFillUsers.get(hash)).toEqual(new Set([node.id]))

      expectDefined(release, 'release')()
      await decoded
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
      expect(ready).toEqual([hash])

      // The next frame invalidates only that node's tiles and renders them again.
      renderer.flushDecodedPreviews(graph)
      canvas.clear(ck.WHITE)
      result = controller.renderFrame(renderer, canvas, graph, 1, 0)
      for (let frame = 0; frame < 10 && result.pending; frame++) {
        result = controller.renderFrame(renderer, canvas, graph, 1, 0)
      }
      expect(result.covered).toBe(true)
      expect(centerPixel(renderer)).toEqual([255, 0, 0, 255])
    } finally {
      renderer.destroy()
    }
  })
})
