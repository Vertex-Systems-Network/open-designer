import * as v from 'valibot'

import { toolNumber, defineTool } from '#core/tools/schema'

export const viewportGet = defineTool({
  name: 'viewport_get',
  description: 'Get current viewport position and zoom level.',
  execution: { kind: 'sync', mutation: 'none' },
  exposure: { webmcp: false },
  input: v.strictObject({}),
  execute: (figma) => {
    return figma.viewport
  }
})

export const viewportSet = defineTool({
  name: 'viewport_set',

  description: 'Set viewport position and zoom.',
  execution: { kind: 'sync', mutation: 'view' },
  input: v.strictObject({
    x: toolNumber(v.pipe(v.number(), v.description('Center X'))),
    y: toolNumber(v.pipe(v.number(), v.description('Center Y'))),
    zoom: toolNumber(v.pipe(v.number(), v.minValue(0.01), v.description('Zoom level')))
  }),
  execute: (figma, { x, y, zoom }) => {
    figma.viewport = { center: { x, y }, zoom }
    return { x, y, zoom }
  }
})

export const viewportZoomToFit = defineTool({
  name: 'viewport_zoom_to_fit',

  description: 'Zoom viewport to fit specified nodes.',
  execution: { kind: 'sync', mutation: 'view' },
  input: v.strictObject({
    ids: v.pipe(v.array(v.string()), v.minLength(1), v.description('Node IDs to fit in view'))
  }),
  execute: (figma, { ids }) => {
    const nodes = ids.map((id) => figma.getNodeById(id)).filter((node) => node !== null)
    if (nodes.length === 0) return { error: 'No valid nodes found' }

    const bounds = nodes.map((node) => node.absoluteBoundingBox)
    const minX = Math.min(...bounds.map((b) => b.x))
    const minY = Math.min(...bounds.map((b) => b.y))
    const maxX = Math.max(...bounds.map((b) => b.x + b.width))
    const maxY = Math.max(...bounds.map((b) => b.y + b.height))
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }

    figma.viewport.scrollAndZoomIntoView(nodes)
    return {
      center,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }
  }
})
