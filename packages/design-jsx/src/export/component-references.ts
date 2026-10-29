import { countBy } from 'es-toolkit/array'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { layersUnder, refName } from '../connectors'
import { Reference, type JSXValue } from './value'

/** How an export names a component. */
export interface ComponentReference {
  /**
   * As a swap property's value or default takes it: by its name where no other component has
   * it, else by its ID.
   */
  name: (component: SceneNode) => string
  /** As `of` takes it: by name, by the `ref()` the export declares for it, or by ID. */
  of: (component: SceneNode) => JSXValue
}

function isComponent(node: SceneNode): boolean {
  return node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
}

/**
 * Names `<Instance of>` resolves in this graph and in another that has the same components,
 * such as a fresh graph the same export renders into. A component whose name another shares is
 * written by the ref `refs` gives it, if any, else by its ID, which only this graph has. The
 * graph is read once, on the first reference.
 */
export function componentReferences(
  graph: SceneGraph,
  refs: ReadonlyMap<string, string | null> = new Map()
): ComponentReference {
  let names: Record<string, number> | undefined
  const name = (component: SceneNode) => {
    names ??= countBy([...graph.getAllNodes()].filter(isComponent), (node) => node.name)
    return component.name && names[component.name] === 1 ? component.name : component.id
  }
  return {
    name,
    of: (component) => {
      const ref = refs.get(component.id)
      const named = name(component)
      return ref && named === component.id ? new Reference(ref) : named
    }
  }
}

/**
 * The refs an export declares: `connectorRefs`, and one for each component under `rootIds`
 * that an instance there is of and whose name another component shares, so a render into a
 * fresh graph finds it. A layer both need takes one ref.
 */
export function exportRefs(
  graph: SceneGraph,
  rootIds: readonly string[],
  connectorRefs: ReadonlyMap<string, string | null>,
  declare: boolean
): ReadonlyMap<string, string | null> {
  if (!declare) return connectorRefs
  const layers = layersUnder(graph, rootIds)
  const reference = componentReferences(graph)
  const under = new Set(layers.map((layer) => layer.id))
  const refs = new Map(connectorRefs)
  const taken = new Set(
    [...connectorRefs.values()].filter((value): value is string => typeof value === 'string')
  )
  for (const layer of layers) {
    if (layer.type !== 'INSTANCE') continue
    const component = layer.componentId ? graph.getNode(layer.componentId) : undefined
    const set = component?.parentId ? graph.getNode(component.parentId) : undefined
    for (const named of [component, set]) {
      if (!named || !isComponent(named) || !under.has(named.id) || refs.get(named.id)) continue
      if (reference.name(named) === named.id) refs.set(named.id, refName(named.name, taken))
    }
  }
  return refs
}
