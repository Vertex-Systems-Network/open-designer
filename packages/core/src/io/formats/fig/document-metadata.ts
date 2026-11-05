import {
  mergePluginData,
  parseGuidOrNull,
  type KiwiNodeChange
} from '@open-designer/fig/node-change'
import { guidToString } from '@open-designer/kiwi/fig/guid'
import type { SceneGraph } from '@open-designer/scene-graph'
import {
  isPluginDataEntry,
  OPEN_DESIGNER_PLUGIN_DATA,
  readPluginData,
  withoutPluginData,
  withPluginData
} from '@open-designer/scene-graph/plugin-data'
import type { GUID } from '@open-designer/scene-graph/primitives'

const { comments, documentId, enabledLibraries } = OPEN_DESIGNER_PLUGIN_DATA

/** The DOCUMENT record's plugin data: the root's own, the libraries it enables, and its id. */
export function applyDocumentPluginData(
  documentNodeChange: KiwiNodeChange,
  graph: SceneGraph,
  nodeIdToGuid: ReadonlyMap<string, GUID>,
  sourceOwners: ReadonlyMap<string, string>
): void {
  const rootPluginData = graph.getNode(graph.rootId)?.pluginData ?? []
  const threads = readPluginData(rootPluginData, comments)
  const withComments = threads
    ? withPluginData(
        rootPluginData,
        comments,
        threads.map((thread) => ({
          ...thread,
          pageId: toGuidId(graph, nodeIdToGuid, sourceOwners, thread.pageId),
          nodeId: thread.nodeId
            ? toGuidId(graph, nodeIdToGuid, sourceOwners, thread.nodeId)
            : thread.nodeId
        }))
      )
    : rootPluginData
  const bindings = [...graph.enabledLibraries.values()]
  // With no libraries enabled, the entry the document was opened with is kept as it was.
  const opened = withComments.find((entry) => isPluginDataEntry(entry, enabledLibraries))
  const withLibraries =
    bindings.length > 0
      ? withPluginData(withComments, enabledLibraries, bindings)
      : [...withoutPluginData(withComments, [enabledLibraries]), ...(opened ? [opened] : [])]
  documentNodeChange.pluginData = mergePluginData(
    withPluginData(withLibraries, documentId, graph.rootId)
  )
}

function toGuidId(
  graph: SceneGraph,
  nodeIdToGuid: ReadonlyMap<string, GUID>,
  sourceOwners: ReadonlyMap<string, string>,
  id: string
): string {
  const node = graph.getNode(id)
  const sourceId = node?.source.id
  const guid =
    nodeIdToGuid.get(id) ??
    (sourceId && sourceOwners.get(sourceId) === id ? parseGuidOrNull(sourceId) : null)
  return guid ? guidToString(guid) : id
}
