import type { NodeType, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { namesComponent, rekaRole } from './behaviours'
import { isComponentProperty } from './component-properties'
import { CONNECTOR_ELEMENT, resolveConnectorEnds } from './connectors'
import { elementNodeType } from './elements'
import { isLayerRef, LayerRefs, type LayerRef } from './refs'
import { renderNode } from './renderer'
import type { DesignJSXServices } from './services'
import { FRAGMENT, isTreeNode, type TreeNode } from './tree'
import type { RenderOptions } from './types'
import { applyVariableDefinitions } from './variables/graph'

export interface RenderResult {
  id: string
  name: string
  type: NodeType
  childIds: string[]
  warnings?: string[]
}

/** The nodes a tree renders as: a fragment's children, or the tree itself. */
function treeRoots(tree: TreeNode): TreeNode[] {
  return tree.type === FRAGMENT ? tree.children.filter(isTreeNode) : [tree]
}

/** The component an element names: its `of`, or the default of the swap property bound there. */
function componentReference(props: Record<string, unknown>): string | LayerRef | undefined {
  const reference = props.of ?? props.componentId ?? props.component
  const value = isComponentProperty(reference) ? reference.defaultValue : reference
  return typeof value === 'string' || isLayerRef(value) ? value : undefined
}

/** Whether an element defines a component: a component, a set, or a Reka root naming none. */
function definesComponent(node: TreeNode): boolean {
  const nodeType = elementNodeType(node.type)
  if (nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET') return true
  return rekaRole(node.type)?.role === 'root' && !namesComponent(node.props)
}

/**
 * The indices of `roots` in render order: roots that define named components before roots that
 * instantiate them.
 */
function rootRenderOrder(roots: TreeNode[]): number[] {
  // By name, and by the ref() that marks the component.
  const componentOwners = new Map<string | LayerRef, Set<number>>()
  const references = roots.map(() => new Set<string | LayerRef>())

  roots.forEach((root, index) => {
    const pending = [root]
    while (pending.length > 0) {
      const node = pending.pop()
      if (!node) continue
      if (definesComponent(node)) {
        const { name, ref } = node.props
        for (const key of [typeof name === 'string' && name, isLayerRef(ref) && ref]) {
          if (!key) continue
          const owners = componentOwners.get(key) ?? new Set<number>()
          owners.add(index)
          componentOwners.set(key, owners)
        }
      } else {
        const reference = componentReference(node.props)
        if (reference) references[index]?.add(reference)
      }
      pending.push(...node.children.filter(isTreeNode))
    }
  })

  const dependencies = references.map((rootReferences, index) => {
    const result = new Set<number>()
    for (const reference of rootReferences) {
      const owners = componentOwners.get(reference)
      if (owners?.size === 1) {
        const owner = owners.values().next().value
        if (owner !== undefined && owner !== index) result.add(owner)
      }
    }
    return result
  })

  const rendered = new Set<number>()
  const order: number[] = []
  while (order.length < roots.length) {
    const next = roots.findIndex(
      (_, index) =>
        !rendered.has(index) &&
        [...(dependencies[index] ?? [])].every((dependency) => rendered.has(dependency))
    )
    // Cyclic component references cannot be resolved by ordering; retain source order for them.
    const index = next === -1 ? roots.findIndex((_, candidate) => !rendered.has(candidate)) : next
    if (index === -1) break
    rendered.add(index)
    order.push(index)
  }

  return order
}

/** Render every root of `tree` into the parent and lay out once. */
export async function renderRoots<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  options: RenderOptions = {}
): Promise<RenderResult[]> {
  const roots = treeRoots(tree)
  if (roots.length === 0) throw new Error('JSX must return a Figma element (Frame, Text, etc)')
  const parentId = options.parentId ?? graph.getPages()[0].id
  applyVariableDefinitions(graph, tree)

  const originalChildCount = graph.getChildren(parentId).length
  // By each root's position in `roots`: a fragment may list one element twice.
  const nodes: SceneNode[] = []
  const eventsByRoot: Array<Array<[TreeNode, SceneNode]>> = []
  const connectorsByRoot: Array<Array<{ node: SceneNode; tree: TreeNode }>> = []
  const refs = new LayerRefs()
  for (const index of rootRenderOrder(roots)) {
    const events: Array<[TreeNode, SceneNode]> = []
    const connectors: Array<{ node: SceneNode; tree: TreeNode }> = []
    eventsByRoot[index] = events
    connectorsByRoot[index] = connectors
    const onNode = (element: TreeNode, node: SceneNode) => {
      if (element.type === CONNECTOR_ELEMENT) connectors.push({ node, tree: element })
      else refs.mark(element.props.ref, node)
      events.push([element, node])
    }
    const node = await renderNode(services, graph, roots[index], parentId, onNode, undefined, refs)
    if (options.x !== undefined) graph.updateNode(node.id, { x: options.x })
    if (options.y !== undefined) graph.updateNode(node.id, { y: options.y })
    nodes[index] = node
  }

  nodes.forEach((node, index) => graph.insertChildAt(node.id, parentId, originalChildCount + index))
  for (const events of eventsByRoot) {
    for (const [element, node] of events) options.onNode?.(element, node)
  }
  const connectors = connectorsByRoot.flat()
  const rootIds = nodes.map((node) => node.id)
  const warnings = [...refs.warnings, ...resolveConnectorEnds(graph, rootIds, connectors, refs)]
  if (!options.deferLayout) services.layout(graph, rootIds)

  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    childIds: node.childIds,
    ...(warnings.length > 0 && { warnings })
  }))
}

/** Render `tree` and return its first root; a fragment's other roots are rendered too. */
export async function renderTree<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const [first] = await renderRoots(services, graph, tree, options)
  return first
}
