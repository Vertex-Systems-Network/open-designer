import { isPlainObject } from 'es-toolkit/predicate'

import { namesComponent, rekaRole } from './behaviours'
import { isComponentProperty } from './component-properties'
import { elementNodeType } from './elements'
import { isLayerRef, type LayerRef } from './refs'
import { isTreeNode, type TreeNode } from './tree'

/** A component as an element names it: by name, or by the `ref()` that marks it. */
type ComponentKey = string | LayerRef

/** The components an element and its descendants define, and those they name. */
interface ComponentUse {
  defines: ReadonlySet<ComponentKey>
  names: ReadonlySet<ComponentKey>
}

const NO_USE: ComponentUse = { defines: new Set(), names: new Set() }

/**
 * The components an element names: its `of`, or the default of the swap property bound there,
 * and the `ref()`s its props and `properties` give swap properties.
 */
function componentReferences(props: Record<string, unknown>): ComponentKey[] {
  const reference = props.component ?? props.componentId ?? props.of
  const value = isComponentProperty(reference) ? reference.defaultValue : reference
  const assigned = [
    ...Object.entries(props)
      .filter(([key]) => key !== 'ref' && key !== 'of')
      .map(([, prop]) => prop),
    ...(isPlainObject(props.properties) ? Object.values(props.properties) : [])
  ].filter(isLayerRef)
  return [...(typeof value === 'string' || isLayerRef(value) ? [value] : []), ...assigned]
}

/** Whether an element defines a component: a component, a set, or a Reka root naming none. */
function definesComponent(node: TreeNode): boolean {
  const nodeType = elementNodeType(node.type)
  if (nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET') return true
  return rekaRole(node.type)?.role === 'root' && !namesComponent(node.props)
}

/** Reads each element's components once, for every level an order is asked at. */
export class RenderOrder {
  private readonly uses = new WeakMap<TreeNode, ComponentUse>()

  private use(node: TreeNode): ComponentUse {
    const known = this.uses.get(node)
    if (known) return known
    const children = node.children.filter(isTreeNode).map((child) => this.use(child))
    const own: ComponentKey[] = []
    const references = definesComponent(node) ? [] : componentReferences(node.props)
    if (definesComponent(node)) {
      const { name, ref } = node.props
      if (typeof name === 'string' && name) own.push(name)
      if (isLayerRef(ref)) own.push(ref)
    }
    const use =
      own.length === 0 && references.length === 0 && children.every((child) => child === NO_USE)
        ? NO_USE
        : {
            defines: new Set([...own, ...children.flatMap((child) => [...child.defines])]),
            names: new Set([...references, ...children.flatMap((child) => [...child.names])])
          }
    this.uses.set(node, use)
    return use
  }

  /**
   * The indices of `siblings` in render order: those that define a component before those that
   * name it, otherwise as written. Components that reference each other keep the written order.
   */
  of(siblings: readonly TreeNode[]): number[] {
    const uses = siblings.map((sibling) => this.use(sibling))
    const identity = siblings.map((_, index) => index)
    if (uses.every((use) => use.defines.size === 0)) return identity
    const owners = new Map<ComponentKey, number[]>()
    uses.forEach((use, index) => {
      for (const key of use.defines) owners.set(key, [...(owners.get(key) ?? []), index])
    })
    const dependencies = uses.map(
      (use, index) =>
        new Set(
          [...use.names].flatMap((key) => owners.get(key) ?? []).filter((owner) => owner !== index)
        )
    )
    const rendered = new Set<number>()
    const order: number[] = []
    while (order.length < siblings.length) {
      const ready = identity.find(
        (index) =>
          !rendered.has(index) &&
          [...(dependencies[index] ?? [])].every((dependency) => rendered.has(dependency))
      )
      const index = ready ?? identity.find((candidate) => !rendered.has(candidate))
      if (index === undefined) break
      rendered.add(index)
      order.push(index)
    }
    return order
  }
}
