import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { instanceSlotFrames, slotPropertyId } from '@open-pencil/scene-graph/slots'

import type { RenderChild } from './behaviours/render'
import { isTreeNode, type TreeNode } from './tree'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function slotPropertyReference(tree: TreeNode): string | undefined {
  const references = tree.props.propertyRefs
  if (!Array.isArray(references)) return undefined
  const reference = references.find((item) => isRecord(item) && item.field === 'SLOT_CONTENT')
  return isRecord(reference) && typeof reference.propertyId === 'string'
    ? reference.propertyId
    : undefined
}

function authoredSlotTrees(tree: TreeNode): Map<string, TreeNode[]> {
  const slots = new Map<string, TreeNode[]>()
  const visit = (node: TreeNode) => {
    if (
      node.type === 'instance' ||
      node.type === 'component' ||
      node.type === 'component-set' ||
      node.props.of !== undefined ||
      node.props.component !== undefined ||
      node.props.componentId !== undefined
    )
      return
    const propertyId = slotPropertyReference(node)
    if (propertyId) slots.set(propertyId, [...(slots.get(propertyId) ?? []), node])
    for (const child of node.children) if (isTreeNode(child)) visit(child)
  }
  for (const child of tree.children) if (isTreeNode(child)) visit(child)
  return slots
}

function insideOwnedSlot(graph: SceneGraph, frame: SceneNode, instance: SceneNode): boolean {
  let parent = frame.parentId ? graph.getNode(frame.parentId) : undefined
  while (parent && parent.id !== instance.id) {
    const propertyId = slotPropertyId(parent)
    if (propertyId && Object.hasOwn(instance.componentPropertyAssignments, propertyId)) return true
    parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
  }
  return false
}

/** Restore authored children for owned slots; unassigned slots keep the component's children. */
export async function restoreOwnedSlotContent(
  graph: SceneGraph,
  instance: SceneNode,
  tree: TreeNode,
  renderChild: RenderChild
): Promise<void> {
  const authored = authoredSlotTrees(tree)
  for (const frame of instanceSlotFrames(graph, instance)) {
    const propertyId = slotPropertyId(frame)
    if (
      !propertyId ||
      !Object.hasOwn(instance.componentPropertyAssignments, propertyId) ||
      insideOwnedSlot(graph, frame, instance)
    )
      continue
    const slotTree = authored.get(propertyId)?.shift()
    for (const child of graph.getChildren(frame.id)) graph.deleteNode(child.id)
    if (!slotTree) continue
    for (const child of slotTree.children) if (isTreeNode(child)) await renderChild(child, frame.id)
  }
}
