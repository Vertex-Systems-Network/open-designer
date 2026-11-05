import type { SceneNode } from '@open-designer/scene-graph'
import { isGeneratedFrame } from '@open-designer/scene-graph/generated'
import { OPEN_DESIGNER_PLUGIN_DATA, readPluginData } from '@open-designer/scene-graph/plugin-data'

// Space between takes the place of the gap in Figma's auto layout. A generated frame keeps it
// as the least space between its sublayers, as a sticky note keeps its author clear of a long body.
function primaryAxisSpacing(node: SceneNode): number {
  const keepsGap =
    readPluginData(node.pluginData, OPEN_DESIGNER_PLUGIN_DATA.penSpaceBetweenGap) === 'true'
  return node.primaryAxisAlign === 'SPACE_BETWEEN' && !isGeneratedFrame(node) && !keepsGap
    ? 0
    : node.itemSpacing
}

export function primaryAxisGap(node: SceneNode): number {
  return Math.max(0, primaryAxisSpacing(node))
}

// Yoga lays out a negative gap as none, so siblings overlap through negative leading margins.
export function siblingOverlap(node: SceneNode): number {
  if (node.layoutWrap === 'WRAP') return 0
  return Math.max(0, -primaryAxisSpacing(node))
}
