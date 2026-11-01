import * as v from 'valibot'

import { fractionalPosition } from '@open-designer/scene-graph/order-keys'

import { defineTool } from '#core/tools/schema'

export const movePage = defineTool({
  name: 'move_page',
  description: 'Move a page to a zero-based position in the document.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    page: v.pipe(v.string(), v.description('Page name or ID')),
    index: v.pipe(v.number(), v.integer(), v.minValue(0), v.description('Zero-based destination index'))
  }),
  execute: (figma, { page, index }) => {
    const pages = figma.root.children
    const target = pages.find((candidate) => candidate.id === page || candidate.name === page)
    if (!target) return { error: `Page "${page}" not found` }

    const destination = Math.min(index, pages.length - 1)
    figma.graph.insertChildAt(target.id, figma.graph.rootId, destination)
    for (const [position, pageId] of figma.graph.getNode(figma.graph.rootId)!.childIds.entries()) {
      const movedPage = figma.graph.getNode(pageId)
      if (!movedPage) continue
      const orderKey = fractionalPosition(position)
      if (movedPage.source.orderKey === orderKey) continue
      figma.graph.updateNode(movedPage.id, {
        source: { ...movedPage.source, orderKey }
      })
    }
    return { page: target.name, id: target.id, index: destination }
  }
})
