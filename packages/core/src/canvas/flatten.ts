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
import { makeImageFillLocalMatrix } from './fills'
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
  | 'name'
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'fills'
  | 'vectorNetwork'
  | 'fillGeometry'
  | StrokeFields
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
    const styled = filled.map(({ node, matrix }) => ({
      node,
      fills: rebaseFills(node.fills, node, matrix, box, renderer, graph)
    }))
    const alike = styled.every(({ fills }) => isEqual(fills, styled[0].fills))
    const fillGeometry = networks.flatMap(({ node, matrix, network }) => {
      if (node.type === 'VECTOR' && node.fillGeometry.length > 0) {
        const fillsForPath = (fills: SceneNode['fills']) =>
          rebaseFills(fills?.length ? fills : node.fills, node, matrix, box, renderer, graph)
        const geometry = node.fillGeometry.map((item) => ({
          ...item,
          fills: fillsForPath(item.fills)
        }))
        return transformGeometryPaths(
          geometry,
          matrix[0],
          matrix[1],
          matrix[3],
          matrix[4],
          matrix[2] - box.x,
          matrix[5] - box.y
        )
      }
      return geometryPathsFromNetwork(
        network,
        rebaseFills(node.fills, node, matrix, box, renderer, graph)
      )
    })
    return {
      name: 'Flatten',
      ...box,
      fills: alike ? copyFills(styled[0]?.fills ?? top.fills) : [],
      vectorNetwork: mergeVectorNetworks(networks.map(({ network }) => network)),
      fillGeometry,
      ...topStroke(top)
    }
  } finally {
    for (const { path } of placed) path.delete()
  }
}

/**
 * Carry a paint's mapping with its source shape as that shape moves into the flattened vector's
 * coordinate system. Fill transforms map from layer space to paint space, so compose their inverse
 * with the source-to-flattened mapping and invert it back to the stored convention.
 */
function rebaseFills(
  fills: SceneNode['fills'] | undefined,
  node: SceneNode,
  matrix: number[],
  box: Rect,
  renderer: SkiaRenderer,
  graph: SceneGraph
): SceneNode['fills'] {
  const sourceToFlat = multiplyAffine(
    scaleAffine(1 / (box.width || 1), 1 / (box.height || 1)),
    multiplyAffine(
      translateAffine(-box.x, -box.y),
      multiplyAffine(matrixAffine(matrix), scaleAffine(node.width || 1, node.height || 1))
    )
  )
  const flatToSource = invertAffine(sourceToFlat)
  if (!flatToSource) return copyFills(fills ?? [])
  return copyFills(fills ?? []).map((fill) => {
    if (fill.gradientTransform) {
      const rebased = multiplyAffine(
        [
          fill.gradientTransform.m00,
          fill.gradientTransform.m01,
          fill.gradientTransform.m02,
          fill.gradientTransform.m10,
          fill.gradientTransform.m11,
          fill.gradientTransform.m12
        ],
        flatToSource
      )
      return { ...fill, gradientTransform: affineTransform(rebased) }
    }
    if (fill.type !== 'IMAGE' || !fill.imageHash) return fill
    const bytes = graph.images.get(fill.imageHash)
    if (!bytes) return fill
    const image = renderer.ck.MakeImageFromEncoded(bytes)
    if (!image) return fill
    let rebased = fill
    try {
      // Encode the original FILL/FIT/TILE layout as an equivalent CROP transform. Those layout
      // modes derive their mapping from node bounds and ignore imageTransform, which no longer
      // describes the source shape once its region has moved into the combined vector.
      const oldLocalMatrix = makeImageFillLocalMatrix(fill, node, image.width(), image.height())
      const sourceToFlatPixels = multiplyAffine(
        translateAffine(-box.x, -box.y),
        matrixAffine(matrix)
      )
      const flatToSourcePixels = invertAffine(sourceToFlatPixels)
      if (flatToSourcePixels) {
        const destinationToImage = multiplyAffine(flatToSourcePixels, oldLocalMatrix as Affine)
        const inverseImageTransform = multiplyAffine(
          scaleAffine(1 / (box.width || 1), 1 / (box.height || 1)),
          multiplyAffine(destinationToImage, scaleAffine(image.width(), image.height()))
        )
        const imageTransform = invertAffine(inverseImageTransform)
        if (imageTransform) {
          rebased = {
            ...fill,
            imageScaleMode: 'CROP',
            imageRotation: 0,
            imageTransform: affineTransform(imageTransform)
          }
        }
      }
    } finally {
      image.delete()
    }
    return rebased
  })
}

type Affine = [number, number, number, number, number, number]

function matrixAffine(matrix: number[]): Affine {
  return [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]]
}

function multiplyAffine(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[1] * b[3],
    a[0] * b[1] + a[1] * b[4],
    a[0] * b[2] + a[1] * b[5] + a[2],
    a[3] * b[0] + a[4] * b[3],
    a[3] * b[1] + a[4] * b[4],
    a[3] * b[2] + a[4] * b[5] + a[5]
  ]
}

function scaleAffine(x: number, y: number): Affine {
  return [x, 0, 0, 0, y, 0]
}

function translateAffine(x: number, y: number): Affine {
  return [1, 0, x, 0, 1, y]
}

function invertAffine([a, b, c, d, e, f]: Affine): Affine | null {
  const det = a * e - b * d
  if (Math.abs(det) < 1e-12) return null
  return [e / det, -b / det, (b * f - e * c) / det, -d / det, a / det, (d * c - a * f) / det]
}

function affineTransform([m00, m01, m02, m10, m11, m12]: Affine) {
  return { m00, m01, m02, m10, m11, m12 }
}

function topStroke(node: SceneNode): Pick<SceneNode, StrokeFields> {
  return {
    strokes:
      node.type === 'LINE'
        ? copyStrokes(node.strokes).map((stroke) => ({ ...stroke, dashPattern: [] }))
        : copyStrokes(node.strokes),
    strokeWeight: node.strokeWeight,
    strokeAlign: node.strokeAlign,
    strokeCap: node.strokeCap,
    strokeJoin: node.strokeJoin,
    strokeMiterLimit: node.strokeMiterLimit,
    dashPattern: node.type === 'LINE' ? [] : [...node.dashPattern]
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
