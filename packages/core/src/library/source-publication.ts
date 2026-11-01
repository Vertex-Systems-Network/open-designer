import type { SceneGraph, SourceLibraryPublication } from '@open-designer/scene-graph'
import {
  OPEN_DESIGNER_PLUGIN_DATA,
  readPluginData,
  withPluginData
} from '@open-designer/scene-graph/plugin-data'

export function readSourceLibraryPublication(graph: SceneGraph): SourceLibraryPublication | null {
  const root = graph.getNode(graph.rootId)
  return readPluginData(root?.pluginData, OPEN_DESIGNER_PLUGIN_DATA.sourceLibraryPublication) ?? null
}

export function writeSourceLibraryPublication(
  graph: SceneGraph,
  publication: SourceLibraryPublication
): void {
  const root = graph.getNode(graph.rootId)
  if (!root) return
  graph.updateNode(root.id, {
    pluginData: withPluginData(
      root.pluginData,
      OPEN_DESIGNER_PLUGIN_DATA.sourceLibraryPublication,
      publication
    )
  })
}
