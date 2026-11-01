import type { Path } from 'canvaskit-wasm'
import { isEqual } from 'es-toolkit'

import type { SceneGraph, SceneNode, VectorNetwork } from '@open-designer/scene-graph'
import { getNodeLocalMatrix } from '@open-designer/scene-graph/coordinate'
import { copyFills, copyStrokes, transformGeometryPaths } from '@open-designer/scene-graph/copy'
import Matrix from '@open-designer/scene-graph/matrix'
import { parseSVGPath } from '@open-designer/scene-graph/parse-path'
import type { Rect, Vector } from '@open-designer/scene-graph/primitives'
import { mergeVectorNetworks } from '@open-designer/scene-graph/vector-network'

import { geometryPathsFromNetwork } from '#core/vector/fill-geometry'

import {
  canContainFlattenableChildren,
  flattenSourcePath,
  placedPath,
  windingRuleOf
} from './boolean'
import type { SkiaRenderer } from './renderer'

/** The stroke a flattened vector takes from its topmost shape. */
type StrokeFields =
  | 'strokes'
  | 'strokeWeight'
  | 'strokeAlign'
  | 'strokeCap'
  | 'strokeJoin'
  | 'strokeMiterLimit'
  | 'dashPattern'

export type VectorFlattenProps = Pick<
  SceneNode,
  'name' | 'x' | 'y' | 'width' | 'height' | 'fills' | 'vectorNetwork' | 'fillGeometry' | StrokeFields
>

/** A shape Flatten takes, and where it sits in the flattened layers' parent. */
interface FlattenLeaf {
  node: SceneNode
  matrix: number[]
}

/**
 * The shapes Flatten takes from `nodes`, bottom first: a frame, group, component or instance
 * gives its visible children, never its own paint (live-verified).
 */
function flattenLeaves(graph: SceneGraph, nodes: SceneNode[]): FlattenLeaf[] {
  const leaves: FlattenLeaf[] = []
  const visit = (node: SceneNode, parent: number[]) => {
    const matrix = Matrix.multiply(parent, getNodeLocalMatrix(node))
    if (!canContainFlattenableChildren(node)) {
      leaves.push({ node, matrix })
      return
    }
    for (const childId of node.childIds) {
      const child = graph.getNode(childId)
      if (child?.visible) visit(child, matrix)
    }
  }
  for (const node of nodes) visit(node, Matrix.identity())
  return leaves
}

/**
 * Layers in one parent in the order they are drawn: Flatten stacks their regions so, whatever the
 * selection's. Layers from several parents, which the Plugin API allows, keep the caller's order.
 */
function inDrawOrder(graph: SceneGraph, nodes: SceneNode[]): SceneNode[] {
  const parentId = nodes[0]?.parentId
  const parent = parentId ? graph.getNode(parentId) : undefined
  if (!parent || nodes.some((node) => node.parentId !== parentId)) return nodes
  return nodes.toSorted((a, b) => parent.childIds.indexOf(a.id) - parent.childIds.indexOf(b.id))
}

/**
 * The vector Flatten makes of `nodes`, as Figma's does (live-verified): each shape's own geometry,
 * its regions filled with its fills, and the topmost shape's stroke. Shapes that all fill alike
 * leave their regions to the layer's fills.
 */
export function flattenNodesToVectorProps(
  renderer: SkiaRenderer,
  graph: SceneGraph,
  nodes: SceneNode[]
): VectorFlattenProps | null {
  const leaves = flattenLeaves(graph, inDrawOrder(graph, nodes))
  const placed: { node: SceneNode; path: Path; matrix: number[] }[] = []
  try {
    for (const { node, matrix } of leaves) {
      const path = flattenSourcePath(renderer, node, graph)
      if (!path) return null
      placed.push({ node, path: placedPath(renderer, path, matrix), matrix })
      path.delete()
    }
    const drawn = placed.filter(({ path }) => !path.isEmpty())
    const box = boundsOf(drawn.map(({ path }) => path))
    const top = leaves.at(-1)?.node
    if (!box || !top) return null
    const networks = drawn.map(({ node, path, matrix }) => ({
      node,
      matrix,
      network: networkIn(renderer, path, box)
    }))
    const filled = networks.filter(({ network }) => network.regions.length > 0)
    const alike = filled.every(({ node }) => isEqual(node.fills, filled[0].node.fills))
    const fillGeometry = networks.flatMap(({ node, matrix, network }) => {
      if (node.type === 'VECTOR' && node.fillGeometry.length > 0) {
        const geometry = node.fillGeometry.map((item) => ({
          ...item,
          fills: item.fills?.length ? item.fills : copyFills(node.fills)
        }))
        return transformGeometryPaths(
          geometry,
          matrix[0], matrix[1], matrix[3], matrix[4], matrix[2] - box.x, matrix[5] - box.y
        )
      }
      return geometryPathsFromNetwork(network, node.fills)
    })
    return {
      name: 'Flatten',
      ...box,
      fills: copyFills((alike ? filled.at(0)?.node : undefined)?.fills ?? top.fills),
      vectorNetwork: mergeVectorNetworks(networks.map(({ network }) => network)),
      fillGeometry,
      ...topStroke(top)
    }
  } finally {
    for (const { path } of placed) path.delete()
  }
}

function topStroke(node: SceneNode): Pick<SceneNode, StrokeFields> {
  return {
    strokes: copyStrokes(node.strokes),
    strokeWeight: node.strokeWeight,
    strokeAlign: node.strokeAlign,
    strokeCap: node.strokeCap,
    strokeJoin: node.strokeJoin,
    strokeMiterLimit: node.strokeMiterLimit,
    dashPattern: [...node.dashPattern]
  }
}

/** The box around `paths`; a straight line keeps a zero side. */
function boundsOf(paths: Path[]): Rect | null {
  if (paths.length === 0) return null
  const all = paths.map((path) => path.getBounds())
  const left = Math.min(...all.map((bounds) => bounds[0]))
  const top = Math.min(...all.map((bounds) => bounds[1]))
  const right = Math.max(...all.map((bounds) => bounds[2]))
  const bottom = Math.max(...all.map((bounds) => bounds[3]))
  if (right <= left && bottom <= top) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function networkIn(renderer: SkiaRenderer, path: Path, box: Vector): VectorNetwork {
  const moved = placedPath(renderer, path, renderer.ck.Matrix.translated(-box.x, -box.y))
  const network = parseSVGPath(moved.toSVGString(), windingRuleOf(renderer, moved))
  moved.delete()
  return network
}
