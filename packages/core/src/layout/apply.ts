import type { Node as YogaNode } from 'yoga-layout'

import type { SceneGraph, SceneNode, VectorNetwork } from '@open-designer/scene-graph'
import { scaleGeometryPaths } from '@open-designer/scene-graph/copy'
import { enforcedAspectRatio } from '@open-designer/scene-graph/layout'
import {
  layoutConstrainedChildRect,
  scaleVectorNetworkForResize
} from '@open-designer/scene-graph/resize'

import { keepsSavedLayout, usesDetachedDerivedLayout } from './derived'

export type ComputeLayoutFn = (graph: SceneGraph, frameId: string) => void

/** The per-axis extent of a network, including Bézier control points. */
function networkExtent(network: VectorNetwork | null): { width: number; height: number } | null {
  if (!network || network.vertices.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const include = (x: number, y: number) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const vertex of network.vertices) include(vertex.x, vertex.y)
  for (const segment of network.segments) {
    const startIndex = segment.start
    const endIndex = segment.end
    if (
      Number.isInteger(startIndex) &&
      startIndex >= 0 &&
      startIndex < network.vertices.length
    ) {
      const start = network.vertices[startIndex]
      include(start.x + segment.tangentStart.x, start.y + segment.tangentStart.y)
    }
    if (Number.isInteger(endIndex) && endIndex >= 0 && endIndex < network.vertices.length) {
      const end = network.vertices[endIndex]
      include(end.x + segment.tangentEnd.x, end.y + segment.tangentEnd.y)
    }
  }
  const width = maxX - minX
  const height = maxY - minY
  return { width, height }
}

/** Dimensions survive collapse and history restoration while keyed by the stable node id. */
const lastBoxWithSize = new Map<string, { width?: number; height?: number }>()

function positiveSize(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Rescale a vector network per axis. A collapsed target axis keeps its geometry so it can recover;
 * an unknown source dimension uses a factor of one while the other known axis still scales.
 */
export function rescaleVectorNetworkForLayout(
  network: VectorNetwork | null,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
  remembered?: { width?: number; height?: number }
): VectorNetwork | null {
  if (!network) return null
  const extent = networkExtent(network)
  const sourceWidth =
    positiveSize(fromWidth) ?? positiveSize(remembered?.width) ?? positiveSize(extent?.width)
  const sourceHeight =
    positiveSize(fromHeight) ?? positiveSize(remembered?.height) ?? positiveSize(extent?.height)
  const targetWidth = positiveSize(toWidth) ?? sourceWidth ?? 1
  const targetHeight = positiveSize(toHeight) ?? sourceHeight ?? 1
  const effectiveWidth = sourceWidth ?? targetWidth
  const effectiveHeight = sourceHeight ?? targetHeight
  return scaleVectorNetworkForResize(
    network,
    effectiveWidth,
    effectiveHeight,
    toWidth > 0 ? targetWidth : effectiveWidth,
    toHeight > 0 ? targetHeight : effectiveHeight
  )
}

type LayoutGeometry = Partial<
  Pick<
    SceneNode,
    'x' | 'y' | 'width' | 'height' | 'vectorNetwork' | 'fillGeometry' | 'strokeGeometry'
  >
>

function vectorSourceSize(
  current: number | undefined,
  remembered: number | undefined,
  extent: number | undefined
): number | undefined {
  return positiveSize(current) ?? positiveSize(remembered) ?? positiveSize(extent)
}

function updateVectorPathGeometry(
  node: Extract<SceneNode, { type: 'VECTOR' }>,
  changes: LayoutGeometry,
  sx: number,
  sy: number
): void {
  if (sx === 1 && sy === 1) return
  if (node.fillGeometry.length > 0) {
    changes.fillGeometry = scaleGeometryPaths(node.fillGeometry, sx, sy)
  }
  if (node.strokeGeometry.length === 0) return
  changes.strokeGeometry =
    node.vectorNetwork && node.vectorNetwork.segments.length > 0
      ? []
      : scaleGeometryPaths(node.strokeGeometry, sx, sy)
}

function rememberVectorSize(
  id: string,
  toWidth: number,
  toHeight: number,
  sourceWidth: number | undefined,
  sourceHeight: number | undefined
): void {
  if (toWidth <= 0 || toHeight <= 0) {
    lastBoxWithSize.set(id, {
      width: positiveSize(toWidth) ?? sourceWidth,
      height: positiveSize(toHeight) ?? sourceHeight
    })
    return
  }
  lastBoxWithSize.delete(id)
}

function updateVectorLayoutGeometry(id: string, node: SceneNode, changes: LayoutGeometry): void {
  if (node.type !== 'VECTOR') return
  const toWidth = changes.width ?? node.width
  const toHeight = changes.height ?? node.height
  const remembered = lastBoxWithSize.get(id)
  const extent = networkExtent(node.vectorNetwork)
  const sourceWidth = vectorSourceSize(node.width, remembered?.width, extent?.width)
  const sourceHeight = vectorSourceSize(node.height, remembered?.height, extent?.height)
  const effectiveWidth = sourceWidth ?? positiveSize(toWidth) ?? 1
  const effectiveHeight = sourceHeight ?? positiveSize(toHeight) ?? 1
  const targetWidth = positiveSize(toWidth) ?? effectiveWidth
  const targetHeight = positiveSize(toHeight) ?? effectiveHeight
  const network = rescaleVectorNetworkForLayout(
    node.vectorNetwork,
    node.width,
    node.height,
    toWidth,
    toHeight,
    remembered
  )
  if (network) changes.vectorNetwork = network
  updateVectorPathGeometry(
    node,
    changes,
    targetWidth / effectiveWidth,
    targetHeight / effectiveHeight
  )
  rememberVectorSize(id, toWidth, toHeight, sourceWidth, sourceHeight)
}

/**
 * Writes only the geometry layout changed. Laying out a large page leaves most layers where they
 * were, and each write would notify every graph listener for nothing. A frame it resizes from
 * `before`, by default the size it has, places the layers its constraints govern; `constrained`
 * marks a write those constraints made, which places its own children in turn.
 */
function writeLayoutGeometry(
  graph: SceneGraph,
  id: string,
  geometry: LayoutGeometry,
  computeLayout: ComputeLayoutFn,
  before?: { width: number; height: number },
  constrained = false
): void {
  const node = graph.getNode(id)
  if (!node) return
  const from = before ?? { width: node.width, height: node.height }
  const changes: LayoutGeometry = {}
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = geometry[key]
    if (value !== undefined && value !== node[key]) changes[key] = value
  }
  updateVectorLayoutGeometry(id, node, changes)
  if (Object.keys(changes).length > 0) graph.updateNode(id, changes)
  if (!CONSTRAINT_PARENT_TYPES.has(node.type)) return
  // Laying out what a file holds, as a page opens or its fonts arrive, resizes a frame only where
  // our layout differs from the one the file saved; its children keep the places it saved.
  if (graph.isApplyingDerivedLayout && !constrained) return
  if (from.width !== node.width || from.height !== node.height) {
    constrainChildren(graph, node, from, computeLayout)
    rememberPlacedSize(node)
  }
}

/**
 * The size each Hug frame's constrained children were last placed for by layout. Keyed by the
 * node, so a deleted frame's entry goes with it and a restored one starts afresh.
 */
const huggedSizes = new WeakMap<SceneNode, { width: number; height: number }>()

function rememberPlacedSize(frame: SceneNode): void {
  const placed = huggedSizes.get(frame)
  if (!placed) return
  placed.width = frame.width
  placed.height = frame.height
}

const CONSTRAINT_PARENT_TYPES: ReadonlySet<SceneNode['type']> = new Set([
  'FRAME',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE'
])

/**
 * Places the children of a frame layout resized by their constraints: every child of a frame
 * without auto layout, and those that ignore an auto layout, as Figma keeps a badge pinned to the
 * right of a Hug button while its label grows. A child it resizes places its own children, and
 * lays out again when it has auto layout.
 */
function constrainChildren(
  graph: SceneGraph,
  frame: SceneNode,
  before: { width: number; height: number },
  computeLayout: ComputeLayoutFn
): void {
  for (const child of graph.getChildren(frame.id)) {
    if (frame.layoutMode !== 'NONE' && child.layoutPositioning !== 'ABSOLUTE') continue
    const size = { width: child.width, height: child.height }
    writeLayoutGeometry(
      graph,
      child.id,
      layoutConstrainedChildRect(
        child,
        before,
        frame,
        child.horizontalConstraint,
        child.verticalConstraint,
        enforcedAspectRatio(child)
      ),
      computeLayout,
      undefined,
      true
    )
    const resized = child.width !== size.width || child.height !== size.height
    if (resized && child.layoutMode !== 'NONE') computeLayout(graph, child.id)
  }
}

/**
 * The size a frame's constrained children move from as it hugs, or null when it hugs no axis.
 * An editor that resizes a Hug frame places its children for the size it sets, which layout then
 * hugs back, as when a parent stretches it; its children move only from the size it last hugged
 * to. An axis it does not hug keeps the size it has.
 */
function hugStart(frame: SceneNode): { width: number; height: number } | null {
  const row = frame.layoutMode === 'HORIZONTAL'
  const hugsWidth = (row ? frame.primaryAxisSizing : frame.counterAxisSizing) === 'HUG'
  const hugsHeight = (row ? frame.counterAxisSizing : frame.primaryAxisSizing) === 'HUG'
  if (!hugsWidth && !hugsHeight) {
    huggedSizes.delete(frame)
    return null
  }
  const hugged = huggedSizes.get(frame)
  return {
    width: hugsWidth && hugged ? hugged.width : frame.width,
    height: hugsHeight && hugged ? hugged.height : frame.height
  }
}

function savedStretchedCrossSize(
  graph: SceneGraph,
  frame: SceneNode,
  axis: 'width' | 'height'
): number | undefined {
  if (frame.source.format !== 'fig') return undefined
  const padding =
    axis === 'width'
      ? frame.paddingLeft + frame.paddingRight
      : frame.paddingTop + frame.paddingBottom
  const sizes = graph
    .getChildren(frame.id)
    .filter(
      (child) =>
        child.visible &&
        child.layoutPositioning !== 'ABSOLUTE' &&
        child.layoutAlignSelf === 'STRETCH'
    )
    .map((child) => child.derivedLayout?.[axis] ?? child[axis])
  return sizes.length > 0 ? Math.max(...sizes) + padding : undefined
}

function applyFrameSize(
  graph: SceneGraph,
  frame: SceneNode,
  yogaNode: YogaNode,
  keepsSaved: boolean,
  computeLayout: ComputeLayoutFn
): void {
  if (frame.layoutMode === 'GRID') {
    if (frame.gridTemplateRows.length === 0) {
      writeLayoutGeometry(graph, frame.id, { height: yogaNode.getComputedHeight() }, computeLayout)
    }
    return
  }

  const before = hugStart(frame)
  if (!before) return

  const updates: LayoutGeometry = {}
  const derived = keepsSaved ? frame.derivedLayout : null
  const primary = frame.layoutMode === 'HORIZONTAL' ? 'width' : 'height'
  const counter = primary === 'width' ? 'height' : 'width'
  const computed = (axis: 'width' | 'height') =>
    axis === 'width' ? yogaNode.getComputedWidth() : yogaNode.getComputedHeight()
  if (frame.primaryAxisSizing === 'HUG') updates[primary] = derived?.[primary] ?? computed(primary)
  if (frame.counterAxisSizing === 'HUG') {
    const savedCross =
      derived?.[counter] ??
      (keepsSaved ? savedStretchedCrossSize(graph, frame, counter) : undefined)
    updates[counter] =
      savedCross === undefined ? computed(counter) : Math.max(savedCross, computed(counter))
  }

  writeLayoutGeometry(graph, frame.id, updates, computeLayout, before)
  huggedSizes.set(frame, { width: frame.width, height: frame.height })
}

function computedChildPosition(
  child: SceneNode,
  yogaChild: YogaNode,
  axis: 'x' | 'y',
  preservesImportedGeometry: boolean,
  keepsSaved: boolean
): number {
  if (preservesImportedGeometry) return child[axis]
  const computed = axis === 'x' ? yogaChild.getComputedLeft() : yogaChild.getComputedTop()
  if (child.type === 'INSTANCE' || !keepsSaved) return computed
  return child.derivedLayout?.[axis] ?? computed
}

function preservesStaleImportedTextSize(child: SceneNode, axis: 'width' | 'height'): boolean {
  const derivedSize = child.derivedLayout?.[axis]
  return (
    child.type === 'TEXT' &&
    child.source.format === 'fig' &&
    derivedSize !== undefined &&
    Math.abs(child[axis] - derivedSize) > 0.001
  )
}

function computedChildSize(
  child: SceneNode,
  yogaChild: YogaNode,
  axis: 'width' | 'height',
  preservesImportedFrameGeometry: boolean,
  keepsSaved: boolean
): number {
  if (
    preservesImportedFrameGeometry ||
    (keepsSaved && preservesStaleImportedTextSize(child, axis))
  ) {
    return child[axis]
  }
  const computed = axis === 'width' ? yogaChild.getComputedWidth() : yogaChild.getComputedHeight()
  if (child.type === 'TEXT' && child.source.format === 'fig') {
    return computed > 0 ? computed : child[axis]
  }
  if (!keepsSaved) return computed
  return child.derivedLayout?.[axis] ?? computed
}

function updateChildFromYoga(
  graph: SceneGraph,
  frame: SceneNode,
  child: SceneNode,
  yogaChild: YogaNode,
  keepsSaved: boolean,
  computeLayout: ComputeLayoutFn
): void {
  if (!child.visible || child.layoutPositioning === 'ABSOLUTE') return

  const savedFig = keepsSaved && child.source.format === 'fig'
  const preservesImportedFrameGeometry =
    savedFig && frame.source.format === 'fig' && (child.type === 'FRAME' || child.type === 'LINE')
  const preservesImportedPosition =
    preservesImportedFrameGeometry || (savedFig && Math.abs(child.rotation) > 0.001)
  writeLayoutGeometry(
    graph,
    child.id,
    {
      x: computedChildPosition(child, yogaChild, 'x', preservesImportedPosition, keepsSaved),
      y: computedChildPosition(child, yogaChild, 'y', preservesImportedPosition, keepsSaved),
      width: computedChildSize(
        child,
        yogaChild,
        'width',
        preservesImportedFrameGeometry,
        keepsSaved
      ),
      height: computedChildSize(
        child,
        yogaChild,
        'height',
        preservesImportedFrameGeometry,
        keepsSaved
      )
    },
    computeLayout
  )
}

function preservesImportedInstanceInternals(child: SceneNode): boolean {
  return child.type === 'INSTANCE' && child.source.format === 'fig'
}

function recomputeGridChild(
  graph: SceneGraph,
  child: SceneNode,
  computeLayout: ComputeLayoutFn
): void {
  const updated = graph.getNode(child.id)
  if (!updated || updated.layoutMode === 'NONE') return

  const savedPrimary = updated.primaryAxisSizing
  const savedCounter = updated.counterAxisSizing
  const updates: Partial<SceneNode> = {}

  if (savedPrimary === 'HUG') updates.primaryAxisSizing = 'FIXED'
  if (savedCounter === 'HUG') updates.counterAxisSizing = 'FIXED'
  if (Object.keys(updates).length > 0) graph.updateNode(child.id, updates)

  computeLayout(graph, child.id)

  const restore: Partial<SceneNode> = {}
  if (updates.primaryAxisSizing) restore.primaryAxisSizing = savedPrimary
  if (updates.counterAxisSizing) restore.counterAxisSizing = savedCounter
  if (Object.keys(restore).length > 0) graph.updateNode(child.id, restore)
}

export function applyYogaLayout(
  graph: SceneGraph,
  frame: SceneNode,
  yogaNode: YogaNode,
  computeLayout: ComputeLayoutFn
): void {
  const keepsSaved = keepsSavedLayout(graph, frame)
  applyFrameSize(graph, frame, yogaNode, keepsSaved, computeLayout)

  const children = graph.getChildren(frame.id)
  let yogaIndex = 0
  for (const child of children) {
    if (yogaIndex >= yogaNode.getChildCount()) continue
    const yogaChild = yogaNode.getChild(yogaIndex)
    yogaIndex++

    updateChildFromYoga(graph, frame, child, yogaChild, keepsSaved, computeLayout)

    if (!child.visible) continue
    if (preservesImportedInstanceInternals(child)) continue

    if (usesDetachedDerivedLayout(graph, child)) {
      computeLayout(graph, child.id)
      continue
    }

    if (child.layoutMode !== 'NONE') {
      if (child.layoutMode === 'GRID' && child.layoutPositioning !== 'ABSOLUTE') {
        computeLayout(graph, child.id)
      } else if (frame.layoutMode === 'GRID' && child.layoutPositioning !== 'ABSOLUTE') {
        recomputeGridChild(graph, child, computeLayout)
      } else {
        applyYogaLayout(graph, child, yogaChild, computeLayout)
      }
    }
  }
}
