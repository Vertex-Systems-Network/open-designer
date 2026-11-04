import { FigmaAPI, MAX_IMAGE_FETCH_BYTES } from '@open-designer/core/figma-api'
import { unionBounds } from '@open-designer/core/geometry'
import { createCanvasKitRasterCodec } from '@open-designer/core/io/formats/raster'

import { renderAutomationImage } from '@/app/automation/bridge/export-handlers'
import type { EditorStore } from '@/app/editor/active-store'
import { listFamilies, listFonts } from '@/app/editor/fonts'
import { createTauriFetch } from '@/app/tauri/http'
import { IS_TAURI } from '@/constants'

// Figma loads `createImageAsync` URLs through its own server; on desktop the native proxy does
// the same, past CORS, which a browser cannot.
const imageFetch = IS_TAURI
  ? createTauriFetch({ maxResponseBytes: MAX_IMAGE_FETCH_BYTES })
  : undefined

export function makeFigmaFromStore(
  store: EditorStore,
  pageId = store.state.currentPageId
): FigmaAPI {
  const api = new FigmaAPI(store.graph, { fetch: imageFetch })
  api.setRenderer(store.renderer ?? null)
  api.icons = store.iconProvider
  api.theme = store.state.theme ?? 'light'
  api.currentPage = api.wrapNode(pageId)
  // The user's selection belongs to the page on screen.
  api.currentPage.selection =
    pageId === store.state.currentPageId
      ? [...store.state.selectedIds]
          .map((id) => api.getNodeById(id))
          .filter((n): n is NonNullable<typeof n> => n !== null)
      : []
  api.viewport = {
    center: {
      x: (-store.state.panX + window.innerWidth / 2) / store.state.zoom,
      y: (-store.state.panY + window.innerHeight / 2) / store.state.zoom
    },
    zoom: store.state.zoom
  }
  if (pageId === store.state.currentPageId) {
    api._setViewportFitHandler((nodes) => {
      if (pageId !== store.state.currentPageId || api.currentPageId !== store.state.currentPageId) {
        return false
      }
      if (nodes.length === 0) return false
      const bounds = unionBounds(nodes.map((node) => node.absoluteBoundingBox))
      if (!bounds) return false
      const maxX = bounds.x + bounds.width
      const maxY = bounds.y + bounds.height
      store.zoomToBounds(bounds.x, bounds.y, maxX, maxY)
      return {
        // zoomToBounds centers the fitted bounds with symmetric padding. Derive center from
        // those bounds so it remains correct before the canvas reports its viewport dimensions.
        center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        zoom: store.state.zoom
      }
    })
  }
  api.exportImage = async (nodeIds, opts) =>
    renderAutomationImage(
      store,
      nodeIds,
      opts.scale ?? 1,
      opts.format ?? 'PNG',
      opts.pageId ?? pageId
    )
  if (store.renderer) api.rasterCodec = createCanvasKitRasterCodec(store.renderer.ck)
  api.listAvailableFontsAsync = async () => {
    const [systemFonts, familyOptions] = await Promise.all([listFonts(), listFamilies()])
    const fonts = systemFonts.flatMap(({ family, faces }) =>
      faces.map(({ style }) => ({ fontName: { family, style } }))
    )
    const seenFamilies = new Set(systemFonts.map(({ family }) => family))
    for (const { family } of familyOptions) {
      if (!seenFamilies.has(family)) fonts.push({ fontName: { family, style: 'Regular' } })
    }
    return fonts
  }
  return api
}
