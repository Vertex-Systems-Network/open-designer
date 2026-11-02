import type { SceneNode, TextPathData } from '@open-designer/scene-graph'

export * from './caret'
export * from './fitting'
export * from './layout'
export * from './sampling'

export function getTextPathData(node: SceneNode): TextPathData | null {
  return node.textPathData
}
