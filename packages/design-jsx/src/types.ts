import type { SceneNode } from '@open-designer/scene-graph'
import type { Vector } from '@open-designer/scene-graph/primitives'

import type { TreeNode } from './tree'

export interface RenderOptions {
  x?: number
  y?: number
  /** Per-root positions, in the same order as the fragment's children. */
  positions?: ReadonlyArray<Partial<Vector>>
  parentId?: string
  /** Called for every layer created from an element, so callers can map source to layers. */
  onNode?: (tree: TreeNode, node: SceneNode) => void
  /** Leave layout to the caller, which lays out once after moving the roots into place. */
  deferLayout?: boolean
}
