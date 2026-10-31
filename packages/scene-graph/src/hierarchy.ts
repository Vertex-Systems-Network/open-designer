import type { SceneGraph } from './graph'
import type { SceneNode } from './types'

/**
 * Makes the parent/child links of loaded data a tree again, so recursive traversals (render,
 * layout, export, undo) cannot loop or overflow the stack on corrupted documents. Walks from the
 * root without recursion and drops every child id that is missing, repeated, the root, or already
 * placed elsewhere (a cycle or a second parent), points each kept child's `parentId` at the parent
 * that lists it, and clears any parent on the root. Returns the number of repairs; a valid tree is
 * left untouched.
 *
 * Adapted from ShadowArcanist/willow 4c0765255 "repair circular references on graph load" (MIT).
 */
export function repairHierarchy(graph: SceneGraph): number {
  const root = graph.nodes.get(graph.rootId)
  if (!root) return 0
  let repairs = 0
  if (root.parentId !== null) {
    root.parentId = null
    repairs++
  }
  const placed = new Set<string>([graph.rootId])
  const walk = (start: SceneNode) => {
    const queue: SceneNode[] = [start]
    // The loop visits ids pushed while it runs, which is the breadth-first walk.
    for (const parent of queue) {
      const kept: string[] = []
      for (const childId of parent.childIds) {
        const child = graph.nodes.get(childId)
        if (!child || placed.has(childId)) {
          repairs++
          continue
        }
        placed.add(childId)
        kept.push(childId)
        if (child.parentId !== parent.id) {
          child.parentId = parent.id
          repairs++
        }
        queue.push(child)
      }
      if (kept.length !== parent.childIds.length) parent.childIds = kept
    }
  }
  walk(root)
  // A graph may retain nodes absent from the root's child lists. Start each disconnected
  // component as a forest root so parent cycles cannot survive into absolute-position walks.
  for (const node of graph.nodes.values()) {
    if (placed.has(node.id)) continue
    if (node.parentId !== null) {
      node.parentId = null
      repairs++
    }
    placed.add(node.id)
    walk(node)
  }
  if (repairs > 0) graph.clearAbsPosCache()
  return repairs
}
