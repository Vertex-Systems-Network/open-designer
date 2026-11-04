import type { SceneGraph } from '@open-designer/scene-graph'

import { extractPageContext } from '#core/io/subgraph'

import { applyDocumentChange, captureDocumentChange, type DocumentChange } from './document-change'

/**
 * Runs an asynchronous page edit against a private graph copy. A successful edit commits only its
 * own node changes; a failed edit is discarded, so writes made to the live graph while it awaited
 * cannot be rolled back with it.
 */
export async function editOnIsolatedPage<T>(
  graph: SceneGraph,
  pageId: string,
  edit: (draft: SceneGraph) => Promise<T>
): Promise<T> {
  const page = graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error(`Page "${pageId}" is no longer available`)
  const draft = extractPageContext(graph, pageId, page.childIds)
  draft.images = new Map(graph.images)
  draft.variables = structuredClone(graph.variables)
  draft.variableCollections = structuredClone(graph.variableCollections)
  draft.enabledLibraries = new Map(graph.enabledLibraries)
  const finish = captureDocumentChange(draft, pageId)
  let result: T
  try {
    result = await edit(draft)
  } catch (error) {
    finish()
    throw error
  }
  const change: DocumentChange = finish()
  applyDocumentChange(graph, mergeConcurrentChildren(graph, change), 'after')
  return result
}

/** Merge additions/removals into the live parent's current child list without replacing it. */
function mergeConcurrentChildren(graph: SceneGraph, change: DocumentChange): DocumentChange {
  const createdIds = new Set(change.created.map((node) => node.id))
  const deletedIds = new Set(change.deleted.map((node) => node.id))
  const before = new Map(change.children.before.map(({ id, childIds }) => [id, childIds]))

  return {
    ...change,
    children: {
      ...change.children,
      after: change.children.after.map((entry) => {
        if (createdIds.has(entry.id)) return entry
        const current = graph.getNode(entry.id)
        if (!current) return entry
        const order = current.childIds.filter((id) => !deletedIds.has(id))
        const newChildren = entry.childIds.filter((id) => createdIds.has(id))

        for (const id of newChildren) {
          const at = entry.childIds.indexOf(id)
          const previous = entry.childIds
            .slice(0, at)
            .toReversed()
            .find((siblingId) => order.includes(siblingId))
          if (previous) {
            order.splice(order.indexOf(previous) + 1, 0, id)
            continue
          }
          const next = entry.childIds.slice(at + 1).find((siblingId) => order.includes(siblingId))
          order.splice(next ? order.indexOf(next) : order.length, 0, id)
        }

        // A parent can be touched in the draft without changing its child order. Preserve the
        // current list in that case too, including siblings created during the asynchronous edit.
        if (newChildren.length === 0 && deletedIds.size === 0 && before.has(entry.id)) {
          return { ...entry, childIds: current.childIds }
        }
        return { ...entry, childIds: order }
      })
    }
  }
}
