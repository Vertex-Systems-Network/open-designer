import { SceneGraph, type SceneNode } from '@open-designer/scene-graph'
import { cloneNodeProps } from '@open-designer/scene-graph/copy'
import { standardStyleName } from '@open-designer/scene-graph/font-style'
import { overriddenBindingField } from '@open-designer/scene-graph/instances/overrides'
import { contentPluginData } from '@open-designer/scene-graph/plugin-data'
import { styleRunReferences } from '@open-designer/scene-graph/text'
import { remapCopiedReferences } from '@open-designer/scene-graph/transfer'
import { variableValueReferences } from '@open-designer/scene-graph/variables'

import { existingAssetKey } from './asset-keys'
import { contentHash } from './hash'
import { assertLibraryAssetKey } from './identity'
import type { LibraryAssetDescriptor, PortableLibrarySnapshot } from './types'

const VOLATILE_NODE_FIELDS = new Set([
  'id',
  'parentId',
  'childIds',
  'source',
  'instanceOverrides',
  'componentPropertyAssignments',
  'textPicture',
  'derivedTextGlyphs',
  'derivedLayout',
  'librarySource'
])

function assetKey(node: SceneNode): string {
  const key = existingAssetKey(node)
  if (!key) throw new Error(`Component ${node.name} has no stable library asset key`)
  assertLibraryAssetKey(key)
  return key
}

function collectNodeClosure(graph: SceneGraph, rootIds: string[]): Set<string> {
  const ids = new Set<string>()
  const pending = [...rootIds]
  while (pending.length > 0) {
    const id = pending.pop()
    if (!id || ids.has(id)) continue
    const node = graph.getNode(id)
    if (!node) continue
    ids.add(id)
    pending.push(...node.childIds)
    if (node.componentId) pending.push(node.componentId)
  }
  return ids
}

function addSnapshotNode(
  source: SceneGraph,
  target: SceneGraph,
  sourceId: string,
  targetParentId: string,
  mappedIds: Map<string, string>
): void {
  const node = source.getNode(sourceId)
  if (!node) return
  const created = target.createNode(node.type, targetParentId, {
    ...cloneNodeProps(node, node.componentId),
    // A behaviour or other plugin content belongs to the asset; where it came from does not.
    pluginData: contentPluginData(node.pluginData)
  })
  mappedIds.set(sourceId, created.id)
  for (const childId of node.childIds)
    addSnapshotNode(source, target, childId, created.id, mappedIds)
}

export function extractLibrarySnapshot(
  source: SceneGraph,
  assetNodeIds?: string[]
): PortableLibrarySnapshot {
  const roots = (assetNodeIds ?? [...source.getAllNodes()].map((node) => node.id))
    .map((id) => source.getNode(id))
    .filter(
      (node): node is SceneNode => node?.type === 'COMPONENT' || node?.type === 'COMPONENT_SET'
    )
    .filter((node) => node.parentId && source.getNode(node.parentId)?.type !== 'COMPONENT_SET')
  const closure = collectNodeClosure(
    source,
    roots.map((node) => node.id)
  )
  const snapshot = new SceneGraph()
  const page = snapshot.getPages()[0]
  page.name = 'Library definitions'
  page.internalOnly = true
  const mappedIds = new Map<string, string>()
  const closureRoots = [...closure]
    .map((id) => source.getNode(id))
    .filter((node): node is SceneNode =>
      Boolean(node && (!node.parentId || !closure.has(node.parentId)))
    )
  for (const root of closureRoots) addSnapshotNode(source, snapshot, root.id, page.id, mappedIds)
  for (const [sourceId, targetId] of mappedIds)
    if (sourceId === targetId) throw new Error('Snapshot IDs must be remapped')
  remapCopiedReferences(snapshot, mappedIds)

  copySnapshotVariables(source, snapshot, closure)

  for (const imageHash of new Set(
    [...closure].flatMap((id) => {
      const node = source.getNode(id)
      return node
        ? node.fills.flatMap((paint) =>
            paint.type === 'IMAGE' && paint.imageHash ? [paint.imageHash] : []
          )
        : []
    })
  )) {
    const image = source.images.get(imageHash)
    if (image) snapshot.images.set(imageHash, new Uint8Array(image))
  }
  return {
    graph: snapshot,
    assetRoots: roots.flatMap((root) => {
      const id = mappedIds.get(root.id)
      const mapped = id ? snapshot.getNode(id) : undefined
      return mapped ? [mapped] : []
    })
  }
}

/** A field as an asset's content compares it. */
function libraryField(node: SceneNode, key: string, value: unknown): unknown {
  // Plugin content such as a behaviour is part of the asset; its bookkeeping is not.
  if (key === 'pluginData') return contentPluginData(node.pluginData)
  if (key === 'fontStyle') return libraryStyleName(node)
  return normalizedLibraryField(key, value)
}

/**
 * The face a text's name names, compared as a name: a file writes the name the text left to its
 * weight and slant, and spells some as Figma's fonts do ("Semi Bold" for "SemiBold").
 */
function libraryStyleName(node: SceneNode): string {
  return (node.fontStyle ?? standardStyleName(node.fontWeight, node.italic))
    .toLowerCase()
    .replace(/\s+/gu, '')
}

function normalizedLibraryField(key: string, value: unknown): unknown {
  if (key === 'lineHeight' && (value === null || value === 17)) return null
  if (
    key === 'fontFeatures' &&
    Array.isArray(value) &&
    (value.length === 0 ||
      JSON.stringify(value) ===
        JSON.stringify([
          { tag: 'LIGA', enabled: true },
          { tag: 'CALT', enabled: true }
        ]))
  ) {
    return []
  }
  if (key === 'fills' && Array.isArray(value)) {
    return value.map((paint) => {
      if (!paint || typeof paint !== 'object' || Array.isArray(paint)) return paint
      return Object.fromEntries(
        Object.entries(paint).filter(
          ([field, fieldValue]) => !(field === 'blendMode' && fieldValue === 'NORMAL')
        )
      )
    })
  }
  return value
}

export function canonicalLibraryNode(
  graph: SceneGraph,
  node: SceneNode,
  dependencyStack = new Set<string>()
): unknown {
  const visualFields = Object.fromEntries(
    Object.entries(node)
      .filter(
        ([key]) =>
          !VOLATILE_NODE_FIELDS.has(key) &&
          key !== 'componentId' &&
          key !== 'instanceIndex' &&
          key !== 'name' &&
          key !== 'symbolDescription'
      )
      .map(([key, value]) => [key, libraryField(node, key, value)])
  )
  const component = node.componentId ? graph.getNode(node.componentId) : undefined
  const dependencyKey =
    component?.type === 'COMPONENT' || component?.type === 'COMPONENT_SET'
      ? assetKey(component)
      : null
  const dependency =
    component && dependencyKey && !dependencyStack.has(component.id)
      ? canonicalLibraryNode(graph, component, new Set([...dependencyStack, component.id]))
      : null
  return {
    ...visualFields,
    componentKey: dependencyKey,
    componentDependency: dependency,
    children: node.childIds.flatMap((id) => {
      const child = graph.getNode(id)
      return child ? [canonicalLibraryNode(graph, child, dependencyStack)] : []
    })
  }
}

export async function describeSnapshotAssets(
  snapshot: PortableLibrarySnapshot
): Promise<LibraryAssetDescriptor[]> {
  return Promise.all(
    snapshot.assetRoots.map(async (node) => ({
      key: assetKey(node),
      type: node.type === 'COMPONENT_SET' ? 'COMPONENT_SET' : 'COMPONENT',
      name: node.name,
      description: node.symbolDescription,
      sourceNodeId: node.id,
      contentHash: await contentHash({
        node: canonicalLibraryNode(snapshot.graph, node, new Set([node.id])),
        variables: [...variablesForAsset(snapshot.graph, node.id)].sort().flatMap((id) => {
          const variable = snapshot.graph.variables.get(id)
          const collection = variable
            ? snapshot.graph.variableCollections.get(variable.collectionId)
            : undefined
          return variable ? [{ variable, collection }] : []
        })
      })
    }))
  )
}

function variablesForAsset(graph: SceneGraph, rootId: string): Set<string> {
  const nodes = collectNodeClosure(graph, [rootId])
  const variables = directVariables(graph, nodes)
  const pending = [...variables]
  while (pending.length > 0) {
    const id = pending.pop()
    const variable = id ? graph.variables.get(id) : undefined
    if (!variable) continue
    for (const value of Object.values(variable.valuesByMode)) {
      for (const reference of variableValueReferences(value)) {
        if (graph.variables.has(reference) && !variables.has(reference)) {
          variables.add(reference)
          pending.push(reference)
        }
      }
    }
  }
  return variables
}

function directVariables(graph: SceneGraph, nodeIds: ReadonlySet<string>): Set<string> {
  const variables = new Set<string>()
  for (const id of nodeIds) {
    const node = graph.getNode(id)
    if (!node) continue
    for (const variableId of nodeVariableReferences(node)) variables.add(variableId)
    for (const collectionId of Object.keys(node.variableModes)) {
      for (const variable of graph.variables.values()) {
        if (variable.collectionId === collectionId) variables.add(variable.id)
      }
    }
  }
  return variables
}

function copySnapshotVariables(
  source: SceneGraph,
  snapshot: SceneGraph,
  nodeIds: ReadonlySet<string>
): void {
  const variables = directVariables(source, nodeIds)
  const pending = [...variables]
  while (pending.length > 0) {
    const id = pending.pop()
    const variable = id ? source.variables.get(id) : undefined
    if (!variable) continue
    for (const value of Object.values(variable.valuesByMode)) {
      for (const reference of variableValueReferences(value)) {
        if (source.variables.has(reference) && !variables.has(reference)) {
          variables.add(reference)
          pending.push(reference)
        }
      }
    }
  }
  const collections = new Set(
    [...variables].flatMap((id) => {
      const collectionId = source.variables.get(id)?.collectionId
      return collectionId ? [collectionId] : []
    })
  )
  for (const id of collections) {
    const collection = source.variableCollections.get(id)
    if (!collection) continue
    snapshot.variableCollections.set(id, {
      ...structuredClone(collection),
      variableIds: collection.variableIds.filter((variableId) => variables.has(variableId))
    })
    snapshot.activeMode.set(id, source.activeMode.get(id) ?? collection.defaultModeId)
  }
  for (const id of variables) {
    const variable = source.variables.get(id)
    if (variable) snapshot.variables.set(id, structuredClone(variable))
  }
}

function nodeVariableReferences(node: SceneNode): string[] {
  const variables = new Set([
    ...Object.values(node.boundVariables),
    ...styleRunReferences(node.styleRuns).variables
  ])
  for (const entries of [
    node.instanceOverrides.self,
    ...node.instanceOverrides.descendants.values()
  ]) {
    for (const [field, value] of entries) {
      if (overriddenBindingField(field) !== null && typeof value === 'string') variables.add(value)
    }
  }
  return [...variables]
}
