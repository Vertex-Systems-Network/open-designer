import * as v from 'valibot'

import { movePageInGraph } from '#core/editor/pages/move'

import { defineTool } from '#core/tools/schema'

export const movePage = defineTool({
  name: 'move_page',
  description: 'Move a page to a zero-based position in the document.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    page: v.pipe(v.string(), v.description('Page name or ID')),
    index: v.pipe(
      v.number(),
      v.integer(),
      v.minValue(0),
      v.description('Zero-based destination index')
    )
  }),
  execute: (figma, { page, index }) => {
    const target = figma.graph.getPages(true).find(
      (candidate) => candidate.id === page || candidate.name === page
    )
    if (!target) return { error: `Page "${page}" not found` }

    const destination = movePageInGraph(figma.graph, target.id, index, { includeInternal: true })
    if (destination === null) return { error: `Page "${page}" not found` }
    return { page: target.name, id: target.id, index: destination }
  }
})
