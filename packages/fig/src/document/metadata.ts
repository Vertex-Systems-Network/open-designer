import type { NodeChange } from '@open-designer/kiwi/fig/codec'
import type { SceneGraph } from '@open-designer/scene-graph'
import { OPEN_DESIGNER_PLUGIN_DATA } from '@open-designer/scene-graph/plugin-data'

import { readNodeChangePluginData } from '../node-change/plugin-data'

export function applyDocumentMetadata(graph: SceneGraph, document: NodeChange | undefined): void {
  const root = graph.getNode(graph.rootId)
  if (!root || !document) return
  root.source.format = 'fig'
  root.pluginData =
    document.pluginData?.map((entry) => ({
      pluginId: entry.pluginID,
      key: entry.key,
      value: entry.value
    })) ?? []
  root.source.fig.rawNodeFields.strokeJoin = document.strokeJoin
  root.source.fig.rawNodeFields.strokeWeight = document.strokeWeight
  const bindings = readNodeChangePluginData(document, OPEN_DESIGNER_PLUGIN_DATA.enabledLibraries)
  for (const binding of bindings ?? []) graph.enabledLibraries.set(binding.libraryId, binding)
}
