import type { SceneGraph, SceneNode } from '@open-designer/scene-graph'
import { cloneNodeProps } from '@open-designer/scene-graph/copy'
import { remapInstanceOverrideState } from '@open-designer/scene-graph/instances/overrides'
import { remapStyleRunReferences } from '@open-designer/scene-graph/text'
import { remapCopiedReferences } from '@open-designer/scene-graph/transfer'
import { mapVariableValueReferences } from '@open-designer/scene-graph/variables'

import { findLibraryDefinition } from './definitions'
import { assertLibraryAssetKey, assertLibraryId, libraryAssetIdentityKey } from './identity'
import type { ComponentLibraryRevision, LibraryAssetDescriptor } from './types'

const INTERNAL_LIBRARY_PAGE_NAME = 'OpenDesigner library definitions'

function libraryResourceId(
  kind: 'variable' | 'collection' | 'mode',
  libraryId: string,
  revisionId: string,
  sourceId: string
): string {
  return `library:${kind}:${JSON.stringify([libraryId, revisionId, sourceId])}`
}

function copyLibraryVariables(
  consumer: SceneGraph,
  revision: ComponentLibraryRevision,
  mappedIds: ReadonlyMap<string, string>
): void {
  const { libraryId, revisionId } = revision.manifest
  const variableIds = new Map(
    [...revision.graph.variables.keys()].map((id) => [
      id,
      libraryResourceId('variable', libraryId, revisionId, id)
    ])
  )
  const collectionIds = new Map(
    [...revision.graph.variableCollections.keys()].map((id) => [
      id,
      libraryResourceId('collection', libraryId, revisionId, id)
    ])
  )
  const modeIds = new Map<string, string>()
  for (const collection of revision.graph.variableCollections.values()) {
    for (const mode of collection.modes) {
      modeIds.set(mode.modeId, libraryResourceId('mode', libraryId, revisionId, mode.modeId))
    }
  }
  const renameVariable = (id: string) => variableIds.get(id) ?? id
  const renameCollection = (id: string) => collectionIds.get(id) ?? id
  const renameMode = (id: string) => modeIds.get(id) ?? id

  for (const [sourceId, targetId] of collectionIds) {
    const source = revision.graph.variableCollections.get(sourceId)
    if (!source || consumer.variableCollections.has(targetId)) continue
    consumer.addCollection({
      ...structuredClone(source),
      id: targetId,
      defaultModeId: renameMode(source.defaultModeId),
      modes: source.modes.map((mode) => ({ ...mode, modeId: renameMode(mode.modeId) })),
      variableIds: source.variableIds.map(renameVariable)
    })
    consumer.activeMode.set(targetId, renameMode(source.defaultModeId))
  }
  for (const [sourceId, targetId] of variableIds) {
    const source = revision.graph.variables.get(sourceId)
    if (!source || consumer.variables.has(targetId)) continue
    consumer.addVariable({
      ...structuredClone(source),
      id: targetId,
      collectionId: renameCollection(source.collectionId),
      valuesByMode: Object.fromEntries(
        Object.entries(source.valuesByMode).map(([modeId, value]) => [
          renameMode(modeId),
          mapVariableValueReferences(value, renameVariable, renameMode)
        ])
      )
    })
  }

  for (const targetId of mappedIds.values()) {
    const node = consumer.getNode(targetId)
    if (!node) continue
    const boundVariables = Object.fromEntries(
      Object.entries(node.boundVariables).map(([field, id]) => [field, renameVariable(id)])
    )
    const variableModes = Object.fromEntries(
      Object.entries(node.variableModes).map(([collection, mode]) => [
        renameCollection(collection),
        renameMode(mode)
      ])
    )
    const instanceOverrides = remapInstanceOverrideState(node.instanceOverrides, {
      node: (id) => id,
      variable: renameVariable
    })
    const styleRuns = remapStyleRunReferences(node.styleRuns, {
      variable: renameVariable,
      style: (id) => id
    })
    consumer.updateNode(targetId, { boundVariables, variableModes, instanceOverrides, styleRuns })
  }
}

export interface MaterializedLibraryAsset {
  componentId: string
  componentSetId: string | null
  pageId: string
  created: boolean
}

function getInternalLibraryPage(graph: SceneGraph): SceneNode {
  const existing = graph
    .getPages(true)
    .find((page) => page.internalOnly && page.name === INTERNAL_LIBRARY_PAGE_NAME)
  if (existing) return existing
  const page = graph.addPage(INTERNAL_LIBRARY_PAGE_NAME)
  graph.updateNode(page.id, { internalOnly: true, visible: false, locked: true })
  return graph.getNode(page.id) ?? page
}

export function libraryDependencyRoots(
  revision: ComponentLibraryRevision,
  descriptor: LibraryAssetDescriptor
): SceneNode[] {
  const root = revision.graph.getNode(descriptor.sourceNodeId)
  if (!root) throw new Error(`Library asset source is missing: ${descriptor.key}`)
  const roots = new Map([[root.id, root]])
  const visited = new Set<string>()
  const pending = [root.id]
  while (pending.length > 0) {
    const id = pending.pop()
    if (!id || visited.has(id)) continue
    visited.add(id)
    const node = revision.graph.getNode(id)
    if (!node) continue
    pending.push(...node.childIds)
    if (!node.componentId) continue
    const component = revision.graph.getNode(node.componentId)
    if (!component) continue
    let definitionRoot = component
    const parent = component.parentId ? revision.graph.getNode(component.parentId) : undefined
    if (parent?.type === 'COMPONENT_SET') definitionRoot = parent
    roots.set(definitionRoot.id, definitionRoot)
    pending.push(definitionRoot.id)
  }
  return [...roots.values()]
}

export function copyLibraryTree(
  source: SceneGraph,
  target: SceneGraph,
  sourceId: string,
  parentId: string,
  mappedIds: Map<string, string>
): void {
  if (mappedIds.has(sourceId)) return
  const node = source.getNode(sourceId)
  if (!node) return
  const created = target.createNode(node.type, parentId, cloneNodeProps(node, node.componentId))
  mappedIds.set(sourceId, created.id)
  for (const childId of node.childIds)
    copyLibraryTree(source, target, childId, created.id, mappedIds)
}

function markDefinitions(
  graph: SceneGraph,
  revision: ComponentLibraryRevision,
  mappedIds: Map<string, string>
): void {
  const descriptorsBySourceId = new Map(
    revision.manifest.assets.map((asset) => [asset.sourceNodeId, asset])
  )
  remapCopiedReferences(graph, mappedIds)
  for (const [sourceId, targetId] of mappedIds) {
    const target = graph.getNode(targetId)
    if (!target) continue
    const descriptor = descriptorsBySourceId.get(sourceId)
    const source = revision.graph.getNode(sourceId)
    const sourceAssetKey =
      descriptor?.key ??
      (source?.type === 'COMPONENT' || source?.type === 'COMPONENT_SET'
        ? (source.componentKey ?? source.sourceLibraryKey ?? source.publishId)
        : null)
    graph.updateNode(targetId, {
      locked: true,
      librarySource: sourceAssetKey
        ? {
            identity: {
              libraryId: revision.manifest.libraryId,
              assetKey: sourceAssetKey,
              revisionId: revision.manifest.revisionId
            },
            sourceNodeId: sourceId,
            readOnly: true
          }
        : target.librarySource
    })
  }
}

function copyImages(source: SceneGraph, target: SceneGraph, mappedIds: Map<string, string>): void {
  const hashes = new Set<string>()
  for (const sourceId of mappedIds.keys()) {
    const node = source.getNode(sourceId)
    const fills = [
      ...(node?.fills ?? []),
      ...(node?.fillGeometry.flatMap((geometry) => geometry.fills ?? []) ?? [])
    ]
    for (const fill of fills) {
      if (fill.type === 'IMAGE' && fill.imageHash) hashes.add(fill.imageHash)
    }
  }
  for (const hash of hashes) {
    const image = source.images.get(hash)
    if (image) target.images.set(hash, new Uint8Array(image))
  }
}

function defaultComponent(graph: SceneGraph, root: SceneNode): SceneNode | undefined {
  if (root.type === 'COMPONENT') return root
  return root.childIds
    .flatMap((id) => {
      const child = graph.getNode(id)
      return child?.type === 'COMPONENT' ? [child] : []
    })
    .sort((left, right) => left.y - right.y || left.x - right.x)[0]
}

export function materializeLibraryAsset(
  consumer: SceneGraph,
  revision: ComponentLibraryRevision,
  assetKey: string
): MaterializedLibraryAsset {
  const { libraryId, revisionId } = revision.manifest
  assertLibraryId(libraryId)
  assertLibraryAssetKey(assetKey)
  consumer.enabledLibraries.set(libraryId, { libraryId, revisionId, enabled: true })
  const existing = findLibraryDefinition(consumer, libraryId, assetKey, revisionId)
  if (existing) {
    const component = defaultComponent(consumer, existing)
    if (!component) throw new Error(`Materialized asset has no component: ${assetKey}`)
    return {
      componentId: component.id,
      componentSetId: existing.type === 'COMPONENT_SET' ? existing.id : null,
      pageId: existing.parentId ?? consumer.rootId,
      created: false
    }
  }

  const descriptor = revision.manifest.assets.find((asset) => asset.key === assetKey)
  if (!descriptor)
    throw new Error(`Library asset not found: ${libraryAssetIdentityKey(libraryId, assetKey)}`)
  const page = getInternalLibraryPage(consumer)
  const mappedIds = new Map<string, string>()
  for (const root of libraryDependencyRoots(revision, descriptor)) {
    copyLibraryTree(revision.graph, consumer, root.id, page.id, mappedIds)
  }
  copyLibraryVariables(consumer, revision, mappedIds)
  markDefinitions(consumer, revision, mappedIds)
  copyImages(revision.graph, consumer, mappedIds)

  const rootId = mappedIds.get(descriptor.sourceNodeId)
  const root = rootId ? consumer.getNode(rootId) : undefined
  if (!root) throw new Error(`Failed to materialize library asset: ${assetKey}`)
  const component = defaultComponent(consumer, root)
  if (!component) throw new Error(`Library asset has no component: ${assetKey}`)
  return {
    componentId: component.id,
    componentSetId: root.type === 'COMPONENT_SET' ? root.id : null,
    pageId: page.id,
    created: true
  }
}
