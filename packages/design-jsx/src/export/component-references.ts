import { countBy } from 'es-toolkit/array'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

/** How an export names a component: by its name where no other component has it, as `of` finds it. */
export type ComponentReference = (component: SceneNode) => string

function isComponent(node: SceneNode): boolean {
  return node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
}

/**
 * Names `<Instance of>` resolves in this graph and in another that has the same components,
 * such as a fresh graph the same export renders into. A name two components share is written
 * as the component's ID. The graph is read once, on the first reference.
 */
export function componentReferences(graph: SceneGraph): ComponentReference {
  let names: Record<string, number> | undefined
  return (component) => {
    names ??= countBy([...graph.getAllNodes()].filter(isComponent), (node) => node.name)
    return component.name && names[component.name] === 1 ? component.name : component.id
  }
}
