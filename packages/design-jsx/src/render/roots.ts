import type { NodeType, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { CONNECTOR_ELEMENT, resolveConnectorEnds } from '../connectors'
import { elementNodeType } from '../elements'
import { LayerRefs } from '../refs'
import { renderNode } from '../renderer'
import type { DesignJSXServices } from '../services'
import { FRAGMENT, isTreeNode, type TreeNode } from '../tree'
import type { RenderOptions } from '../types'
import { applyVariableDefinitions } from '../variables/graph'

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

/** Render roots that define named components before roots that instantiate them. */
function rootRenderOrder(roots: TreeNode[]): TreeNode[] {
  const componentOwners = new Map<string, Set<number>>()
  const references = roots.map(() => new Set<string>())

  roots.forEach((root, index) => {
    const pending = [root]
    while (pending.length > 0) {
      const node = pending.pop()
      if (!node) continue
      const nodeType = elementNodeType(node.type)
      if (node.type === 'instance') {
        const reference = node.props.of ?? node.props.componentId ?? node.props.component
        if (typeof reference === 'string') references[index]?.add(reference)
      } else if (nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET') {
        const name = node.props.name
        if (typeof name === 'string' && name) {
          const owners = componentOwners.get(name) ?? new Set<number>()
          owners.add(index)
          componentOwners.set(name, owners)
        }
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

  return order.map((index) => roots[index])
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
  const nodesByRoot = new Map<TreeNode, SceneNode>()
  const eventsByRoot = new Map<TreeNode, Array<[TreeNode, SceneNode]>>()
  const connectorsByRoot = new Map<TreeNode, Array<{ node: SceneNode; tree: TreeNode }>>()
  const refs = new LayerRefs()
  for (const root of rootRenderOrder(roots)) {
    const events: Array<[TreeNode, SceneNode]> = []
    const connectors: Array<{ node: SceneNode; tree: TreeNode }> = []
    eventsByRoot.set(root, events)
    connectorsByRoot.set(root, connectors)
    const onNode = (element: TreeNode, node: SceneNode) => {
      if (element.type === CONNECTOR_ELEMENT) connectors.push({ node, tree: element })
      else refs.mark(element.props.ref, node)
      events.push([element, node])
    }
    const node = await renderNode(services, graph, root, parentId, onNode)
    if (options.x !== undefined) graph.updateNode(node.id, { x: options.x })
    if (options.y !== undefined) graph.updateNode(node.id, { y: options.y })
    nodesByRoot.set(root, node)
  }

  const nodes: SceneNode[] = []
  for (const root of roots) {
    const node = nodesByRoot.get(root)
    if (!node) throw new Error('Failed to render a JSX root')
    nodes.push(node)
  }
  nodes.forEach((node, index) => graph.insertChildAt(node.id, parentId, originalChildCount + index))
  for (const root of roots) {
    for (const [element, node] of eventsByRoot.get(root) ?? []) options.onNode?.(element, node)
  }
  const connectors = roots.flatMap((root) => connectorsByRoot.get(root) ?? [])
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
