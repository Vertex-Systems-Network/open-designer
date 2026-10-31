import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { INSTANCE_OVERRIDE_FIELDS } from '@open-pencil/scene-graph/instances'
import { setInstanceOverride } from '@open-pencil/scene-graph/instances/overrides'

import { propsToOverrides } from '../overrides'
import { isLayerRef, type LayerRefs } from '../refs'
import type { RenderContext } from '../render/node'
import { applyBindings, layerMetadata, preparePropsForRender } from '../render/props'
import type { TreeNode } from '../tree'
import { variableModes } from '../variables/graph'
import { assignComponentProperties, assignNamedProperties } from './assignments'
import {
  bindProperties,
  componentPropNames as namesOnInstance,
  exposeInstance,
  type ComponentLookup
} from './properties'

function findComponentByName(graph: SceneGraph, name: string): SceneNode | undefined {
  for (const node of graph.getAllNodes()) {
    if (node.type === 'COMPONENT' && node.name === name) return node
  }
  return undefined
}

function findVariantInSet(
  graph: SceneGraph,
  componentSet: SceneNode,
  props: Record<string, unknown>
) {
  const requested = Object.fromEntries(
    Object.entries(props)
      .filter(([key]) =>
        componentSet.componentPropertyDefinitions.some(
          (definition) => definition.type === 'VARIANT' && definition.name === key
        )
      )
      .map(([key, value]) => [key, String(value)])
  )
  const variants = graph.getChildren(componentSet.id).filter((node) => node.type === 'COMPONENT')
  return (
    variants.find((variant) =>
      Object.entries(requested).every(
        ([key, value]) => variant.componentPropertyValues[key] === value
      )
    ) ?? variants[0]
  )
}

/** The component or component set an element names by id or name. */
function namedComponent(
  graph: SceneGraph,
  props: Record<string, unknown>,
  refs?: LayerRefs
): SceneNode | undefined {
  const ref = props.component ?? props.componentId ?? props.of
  if (isLayerRef(ref)) {
    const marked = graph.getNode(refs?.layerOf(ref) ?? '')
    return marked?.type === 'COMPONENT' || marked?.type === 'COMPONENT_SET' ? marked : undefined
  }
  if (typeof ref !== 'string') return undefined

  const byId = graph.getNode(ref)
  if (byId?.type === 'COMPONENT' || byId?.type === 'COMPONENT_SET') return byId

  const byName = findComponentByName(graph, ref)
  if (byName) return byName

  for (const node of graph.getAllNodes()) {
    if (node.type === 'COMPONENT_SET' && node.name === ref) return node
  }
  return undefined
}

function resolveComponent(
  graph: SceneGraph,
  props: Record<string, unknown>,
  refs?: LayerRefs
): SceneNode | undefined {
  const named = namedComponent(graph, props, refs)
  return named?.type === 'COMPONENT_SET' ? findVariantInSet(graph, named, props) : named
}

/**
 * The names an element sets on its component by prop: properties such as `State` or `Title`, and
 * exposed instances. The instance it rendered as, if given, names its component.
 */
export function componentPropNames(
  graph: SceneGraph,
  props: Record<string, unknown>,
  rendered?: SceneNode
): string[] {
  const component =
    rendered?.type === 'INSTANCE'
      ? graph.getNode(rendered.componentId ?? '')
      : resolveComponent(graph, props)
  return component ? namesOnInstance(graph, component) : []
}

/** The error for an `<Instance>` whose component no name, ID, or ref finds. */
function componentNotFound(props: Record<string, unknown>): Error {
  const ref = props.component ?? props.componentId ?? props.of
  if (isLayerRef(ref)) return new Error('<Instance> ref() marks no component rendered before it')
  const label = typeof ref === 'string' || typeof ref === 'number' ? String(ref) : ''
  return new Error(`<Instance> component not found: ${label}`)
}

export async function renderInstanceNode(
  graph: SceneGraph,
  tree: TreeNode,
  parentId: string,
  context?: RenderContext
): Promise<SceneNode> {
  const parent = graph.getNode(parentId)
  const parentLayout = parent?.layoutMode ?? 'NONE'
  const modes = variableModes(graph, tree.props.mode)
  const lookup = componentIdNamed(graph, context?.refs)
  const bound = bindProperties(graph, tree.props, 'INSTANCE', parentId, lookup)
  const { props, bindings } = preparePropsForRender(graph, bound.props, false, { parentId, modes })
  const component = resolveComponent(graph, props, context?.refs)
  if (!component) throw componentNotFound(props)
  const overrides: Partial<SceneNode> = {
    ...propsToOverrides(props, false, parentLayout),
    ...layerMetadata(modes, bound.references)
  }
  // Instances inherit their container layout, but explicitly authored dimensions
  // must also replace the inherited sizing mode on that axis.
  const layout = overrides.layoutMode ?? component.layoutMode
  if (layout !== 'NONE') {
    const axes =
      layout === 'HORIZONTAL'
        ? (['primaryAxisSizing', 'counterAxisSizing'] as const)
        : (['counterAxisSizing', 'primaryAxisSizing'] as const)
    for (const [dimension, field] of [
      ['w', axes[0]],
      ['h', axes[1]]
    ] as const) {
      const value = props[dimension]
      if (typeof value === 'number') overrides[field] = 'FIXED'
      else if (value === 'hug' || value === 'fill') overrides[field] = 'HUG'
    }
  }
  const instance =
    graph.createInstance(component.id, parentId, overrides) ?? graph.createNode('FRAME', parentId)
  try {
    for (const [field, value] of Object.entries(overrides)) {
      setInstanceOverride(instance.instanceOverrides, instance.id, instance.id, field, value)
    }
    graph.updateNode(instance.id, { instanceOverrides: instance.instanceOverrides })
    applyBindings(graph, instance.id, bindings)
    applyInstanceOverrides(graph, instance, tree.props.overrides)
    assignNamedProperties(graph, instance, props, lookup)
    assignComponentProperties(graph, instance, props.properties, lookup)
    if (props.exposed === true) exposeInstance(graph, instance)
    return instance
  } catch (error) {
    graph.deleteNode(instance.id)
    throw error
  }
}

/**
 * The fields an instance may override in its layers, as Figma allows; where a layer sits, its
 * shape, its place in the tree, and its component follow the component.
 */
const OVERRIDE_FIELDS = new Set<string>(INSTANCE_OVERRIDE_FIELDS)

/**
 * Apply child overrides to a freshly created instance. Keys are
 * `childName:prop` (e.g. 'label:text', 'icon:fills'); the child is resolved by
 * name among the instance's descendants, before any override renames one, and the
 * value is applied to both the child node and the instance's overrides record so
 * component sync keeps it. A name several descendants share is an error.
 */
function applyInstanceOverrides(
  graph: SceneGraph,
  instance: SceneNode,
  overridesProp: unknown
): void {
  if (!overridesProp || typeof overridesProp !== 'object') return
  if (Array.isArray(overridesProp)) return
  const entries = Object.entries(overridesProp)
  if (entries.length === 0) return

  const descendants: SceneNode[] = []
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    descendants.push(node)
    for (const cid of node.childIds) walk(cid)
  }
  for (const cid of instance.childIds) walk(cid)

  // A layer's name may hold a colon; a field's never does.
  const targets = entries.flatMap(([key, value]) => {
    const sep = key.lastIndexOf(':')
    if (sep === -1) return []
    const childName = key.slice(0, sep)
    const prop = key.slice(sep + 1)
    if (!OVERRIDE_FIELDS.has(prop)) return []
    const matches = descendants.filter((n) => n.name === childName)
    if (matches.length > 1)
      throw new Error(
        `overrides key ${key} is ambiguous: ${matches.length} layers are named ${childName}`
      )
    const child = matches.at(0)
    return child ? [{ child, prop, value }] : []
  })
  for (const { child, prop, value } of targets) {
    graph.updateNode(child.id, { [prop]: value })
    setInstanceOverride(instance.instanceOverrides, instance.id, child.id, prop, value)
  }
  if (targets.length > 0) {
    graph.updateNode(instance.id, { instanceOverrides: instance.instanceOverrides })
  }
}

/** The component a swap property's default names, by ID or name, as `<Instance of>` finds it. */
export function componentIdNamed(graph: SceneGraph, refs?: LayerRefs): ComponentLookup {
  return (reference) => resolveComponent(graph, { of: reference }, refs)?.id
}
