import type { NodeType, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { CONNECTOR_ELEMENT, resolveConnectorEnds } from '../figjam/connectors'
import { LayerRefs } from '../refs'
import type { DesignJSXServices } from '../services'
import { FRAGMENT, isTreeNode, type TreeNode } from '../tree'
import { applyVariableDefinitions, definesVariables } from '../variables/graph'
import { renderNode, type RenderContext } from './node'
import { RenderOrder } from './order'
import type { RenderOptions } from './types'

export interface RenderResult {
  id: string
  name: string
  type: NodeType
  childIds: string[]
  warnings?: string[]
}

/** `nodeId` and the layers it is in, nearest first. */
function ancestors(graph: SceneGraph, nodeId: string): SceneNode[] {
  const node = graph.getNode(nodeId)
  return node ? [node, ...ancestors(graph, node.parentId ?? '')] : []
}

/** The nodes a tree renders as: a fragment's children, or the tree itself. */
function treeRoots(tree: TreeNode): TreeNode[] {
  return tree.type === FRAGMENT ? tree.children.filter(isTreeNode) : [tree]
}

/** Put `entries` back in `map`, in place, so whoever holds the map sees them. */
function restoreMap<K, V>(map: Map<K, V>, entries: [K, V][]): void {
  map.clear()
  for (const [key, value] of entries) map.set(key, value)
}

/**
 * What rendering `tree` into `parentId` can change outside its own layers, recorded so a failed
 * render can put it back: the parent's children, the property definitions `property()` adds
 * to the components around the parent, and the variables the JSX defines.
 */
function undoRender(graph: SceneGraph, parentId: string, tree: TreeNode): () => void {
  const childIds = new Set(graph.getNode(parentId)?.childIds)
  const owners = ancestors(graph, parentId).filter(
    (node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
  )
  const definitions = owners.map((owner) => owner.componentPropertyDefinitions)
  const variables = definesVariables(tree)
    ? {
        variables: structuredClone([...graph.variables]),
        collections: structuredClone([...graph.variableCollections])
      }
    : undefined
  return () => {
    for (const child of graph.getChildren(parentId))
      if (!childIds.has(child.id)) graph.deleteNode(child.id)
    owners.forEach((owner, index) =>
      graph.updateNode(owner.id, { componentPropertyDefinitions: definitions[index] })
    )
    if (variables) {
      restoreMap(graph.variables, variables.variables)
      restoreMap(graph.variableCollections, variables.collections)
    }
  }
}

/** The render in flight on each graph, which the next waits for. */
const rendering = new WeakMap<SceneGraph, Promise<unknown>>()

/**
 * Render every root of `tree` into the parent and lay out once. Renders into one graph run one
 * after another, so a failed render puts back only what it changed.
 */
export function renderRoots<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  options: RenderOptions = {}
): Promise<RenderResult[]> {
  const previous = rendering.get(graph) ?? Promise.resolve()
  const render = previous
    .catch(() => undefined)
    .then(() => renderRootsNow(services, graph, tree, options))
  rendering.set(graph, render)
  return render
}

async function renderRootsNow<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  options: RenderOptions
): Promise<RenderResult[]> {
  const roots = treeRoots(tree)
  if (roots.length === 0) throw new Error('JSX must return a Figma element (Frame, Text, etc)')
  const parentId = options.parentId ?? graph.getPages()[0].id
  const undo = undoRender(graph, parentId, tree)
  try {
    return await renderInto(services, graph, tree, roots, parentId, options)
  } catch (error) {
    // A failed render leaves nothing behind, roots rendered before the failing one included.
    undo()
    throw error
  }
}

async function renderInto<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  roots: TreeNode[],
  parentId: string,
  options: RenderOptions
): Promise<RenderResult[]> {
  applyVariableDefinitions(graph, tree)
  const originalChildCount = graph.getChildren(parentId).length
  // By each root's position in `roots`: a fragment may list one element twice.
  const nodes: SceneNode[] = []
  const eventsByRoot: Array<Array<[TreeNode, SceneNode]>> = []
  const connectorsByRoot: Array<Array<{ node: SceneNode; tree: TreeNode }>> = []
  const context: RenderContext = { refs: new LayerRefs(), order: new RenderOrder(), warnings: [] }
  const { refs } = context
  for (const index of context.order.of(roots)) {
    const events: Array<[TreeNode, SceneNode]> = []
    const connectors: Array<{ node: SceneNode; tree: TreeNode }> = []
    eventsByRoot[index] = events
    connectorsByRoot[index] = connectors
    const onNode = (element: TreeNode, node: SceneNode) => {
      if (element.type === CONNECTOR_ELEMENT) connectors.push({ node, tree: element })
      else refs.mark(element.props.ref, node)
      events.push([element, node])
    }
    const node = await renderNode(
      services,
      graph,
      roots[index],
      parentId,
      onNode,
      undefined,
      context
    )
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
  const warnings = [
    ...refs.warnings,
    ...context.warnings,
    ...resolveConnectorEnds(graph, rootIds, connectors, refs)
  ]
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
