import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export type ComponentReferenceMap = ReadonlyMap<string, string>

/** Names resolve across graphs only when the exported component is included and unambiguous. */
export function componentReferences(
  graph: SceneGraph,
  roots: readonly string[]
): ComponentReferenceMap {
  const included = new Map<string, SceneNode>()
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const node = graph.getNode(id)
    if (!node || node.type === 'INSTANCE') return
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') included.set(node.id, node)
    for (const child of graph.getChildren(id)) visit(child.id)
  }
  roots.forEach(visit)

  const names = new Map<string, number>()
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') continue
    names.set(node.name, (names.get(node.name) ?? 0) + 1)
  }

  return new Map(
    [...included.values()].map((node) => [
      node.id,
      node.name && names.get(node.name) === 1 ? node.name : node.id
    ])
  )
}

export function componentReference(
  component: SceneNode,
  references: ComponentReferenceMap
): string {
  return references.get(component.id) ?? component.id
}
