import { isPlainObject } from 'es-toolkit/predicate'

import { namesComponent, rekaRole } from './behaviours'
import { isComponentProperty } from './component-properties'
import { DESIGN_JSX_SUPPORTED_PROPERTIES } from './definitions'
import { elementNodeType } from './elements'
import { isLayerRef, type LayerRef } from './refs'
import { isTreeNode, type TreeNode } from './tree'

/** A component as an element names it: by name, or by the `ref()` that marks it. */
type ComponentKey = string | LayerRef

/**
 * The components an element and its descendants define, those they name, and those a text value
 * may name: a property prop's text is a swap's component or just text, which only the
 * component's properties tell, and they are not known before it renders.
 */
interface ComponentUse {
  defines: ReadonlySet<ComponentKey>
  names: ReadonlySet<ComponentKey>
  mayName: ReadonlySet<ComponentKey>
}

const NO_USE: ComponentUse = { defines: new Set(), names: new Set(), mayName: new Set() }

/**
 * The components an element names: its `of`, or the default of the swap property bound there,
 * and the `ref()`s its property props and `properties` give; and the text values they give,
 * which a swap may take as a component's name.
 */
function componentReferences(props: Record<string, unknown>): {
  names: ComponentKey[]
  mayName: string[]
} {
  const reference = props.component ?? props.componentId ?? props.of
  const value = isComponentProperty(reference) ? reference.defaultValue : reference
  const assigned = [
    ...Object.entries(props)
      .filter(([key]) => !DESIGN_JSX_SUPPORTED_PROPERTIES.has(key))
      .map(([, prop]) => prop),
    ...(isPlainObject(props.properties) ? Object.values(props.properties) : [])
  ]
  return {
    names: [
      ...(typeof value === 'string' || isLayerRef(value) ? [value] : []),
      ...assigned.filter(isLayerRef)
    ],
    mayName: assigned.filter((item): item is string => typeof item === 'string')
  }
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
    const references = definesComponent(node)
      ? { names: [], mayName: [] }
      : componentReferences(node.props)
    if (definesComponent(node)) {
      const { name, ref } = node.props
      if (typeof name === 'string' && name) own.push(name)
      if (isLayerRef(ref)) own.push(ref)
    }
    const use =
      own.length === 0 &&
      references.names.length === 0 &&
      references.mayName.length === 0 &&
      children.every((child) => child === NO_USE)
        ? NO_USE
        : {
            defines: new Set([...own, ...children.flatMap((child) => [...child.defines])]),
            names: new Set([...references.names, ...children.flatMap((child) => [...child.names])]),
            mayName: new Set([
              ...references.mayName,
              ...children.flatMap((child) => [...child.mayName])
            ])
          }
    this.uses.set(node, use)
    return use
  }

  /**
   * The indices of `siblings` in render order: those that define a component before those that
   * name it, otherwise as written. When none is ready, what text values may name gives way first,
   * so a text that happens to match a component's name never holds back a real reference; only
   * components that do reference each other keep the written order.
   */
  of(siblings: readonly TreeNode[]): number[] {
    const uses = siblings.map((sibling) => this.use(sibling))
    const identity = siblings.map((_, index) => index)
    if (uses.every((use) => use.defines.size === 0)) return identity
    const owners = new Map<ComponentKey, number[]>()
    uses.forEach((use, index) => {
      for (const key of use.defines) owners.set(key, [...(owners.get(key) ?? []), index])
    })
    const ownersOf = (keys: ReadonlySet<ComponentKey>, index: number) =>
      [...keys].flatMap((key) => owners.get(key) ?? []).filter((owner) => owner !== index)
    const names = uses.map((use, index) => ownersOf(use.names, index))
    const mayName = uses.map((use, index) => ownersOf(use.mayName, index))
    const rendered = new Set<number>()
    const order: number[] = []
    const readyBy = (dependencies: number[][]) =>
      identity.find(
        (index) =>
          !rendered.has(index) &&
          (dependencies[index] ?? []).every((dependency) => rendered.has(dependency))
      )
    while (order.length < siblings.length) {
      const index =
        readyBy(names.map((dependencies, at) => [...dependencies, ...(mayName[at] ?? [])])) ??
        readyBy(names) ??
        identity.find((candidate) => !rendered.has(candidate))
      if (index === undefined) break
      rendered.add(index)
      order.push(index)
    }
    return order
  }
}
