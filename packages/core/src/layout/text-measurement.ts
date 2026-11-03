import type { SceneNode } from '@open-designer/scene-graph'
import { faceStyleKey } from '@open-designer/scene-graph/font-style'
import { lineHeightPixels } from '@open-designer/scene-graph/text'

import { measureTextWithFont } from '#core/text/font/glyphs'

export type TextMeasurer = (
  node: SceneNode,
  maxWidth?: number
) => { width: number; height: number } | null

let globalTextMeasurer: TextMeasurer | null = null

const GLYPH_WIDTH_FACTOR = 0.6

export function estimateTextSize(
  node: SceneNode,
  maxWidth?: number
): { width: number; height: number } {
  const fontSize = node.fontSize || 14
  const text = node.text || ''
  const runs = node.styleRuns.toSorted((a, b) => a.start - b.start)
  const hasRunMetrics = runs.some((run) =>
    ['fontSize', 'lineHeight', 'letterSpacing'].some((field) => Object.hasOwn(run.style, field))
  )

  // With no renderer, estimate each character using its resolved run size. Binding updates can
  // change a run without changing the text node's base font, so a node-wide estimate is wrong.
  if (hasRunMetrics) return estimateRunTextSize(node, text, runs, fontSize, maxWidth)

  const family = node.fontFamily || 'Inter'
  const style = faceStyleKey({ ...node, fontWeight: node.fontWeight || 400 })
  const ownLineH = lineHeightPixels(node.lineHeight, fontSize) ?? 0
  const explicitLineH = ownLineH > 0 ? ownLineH : undefined
  const measured = measureTextWithFont(text, fontSize, family, style, maxWidth, explicitLineH)
  if (measured) return measured

  const charWidth = fontSize * GLYPH_WIDTH_FACTOR
  const singleLineWidth = Math.ceil(text.length * charWidth)
  const lineH = explicitLineH ?? Math.ceil(fontSize * 1.4)

  if (maxWidth && maxWidth > 0 && singleLineWidth > maxWidth) {
    const lines = Math.ceil(singleLineWidth / maxWidth)
    return { width: maxWidth, height: Math.ceil(lines * lineH) }
  }
  return { width: singleLineWidth, height: lineH }
}

function estimateRunTextSize(
  node: SceneNode,
  text: string,
  runs: SceneNode['styleRuns'],
  fontSize: number,
  maxWidth?: number
): { width: number; height: number } {
  let runIndex = 0
  const line = { width: 0, height: Math.ceil(fontSize * 1.4) }
  const lineWidths: number[] = []
  const lineHeights: number[] = []
  for (let index = 0; index < text.length; index++) {
    while (runIndex < runs.length && runs[runIndex].start + runs[runIndex].length <= index)
      runIndex++
    const run =
      runs[runIndex]?.start <= index && index < runs[runIndex].start + runs[runIndex].length
        ? runs[runIndex]
        : undefined
    appendRunCharacter(node, text[index], run, fontSize, maxWidth, line, lineWidths, lineHeights)
  }
  lineWidths.push(line.width)
  lineHeights.push(line.height)
  const width = Math.ceil(Math.max(0, ...lineWidths))
  const height = lineHeights.reduce((total, value) => total + value, 0)
  return { width: maxWidth && width > maxWidth ? maxWidth : width, height }
}

interface EstimatedLine {
  width: number
  height: number
}

function appendRunCharacter(
  node: SceneNode,
  character: string,
  run: SceneNode['styleRuns'][number] | undefined,
  fontSize: number,
  maxWidth: number | undefined,
  line: EstimatedLine,
  lineWidths: number[],
  lineHeights: number[]
): void {
  const baseHeight = Math.ceil(fontSize * 1.4)
  if (character === '\n') {
    lineWidths.push(line.width)
    lineHeights.push(line.height)
    line.width = 0
    line.height = baseHeight
    return
  }
  const size = run?.style.fontSize ?? fontSize
  const spacing = run?.style.letterSpacing?.value ?? node.letterSpacing?.value ?? 0
  const charWidth = Math.max(0, size * GLYPH_WIDTH_FACTOR + spacing)
  const maxLineWidth = maxWidth && maxWidth > 0 ? maxWidth : undefined
  if (maxLineWidth && line.width > 0 && line.width + charWidth > maxLineWidth) {
    lineWidths.push(line.width)
    lineHeights.push(line.height)
    line.width = 0
    line.height = baseHeight
  }
  line.width += charWidth
  const lineHeightValue =
    run && Object.hasOwn(run.style, 'lineHeight') ? run.style.lineHeight : node.lineHeight
  line.height = Math.max(line.height, lineHeightPixels(lineHeightValue, size) ?? Math.ceil(size * 1.4))
}

export function autoWidthWrapWidth(
  node: Pick<SceneNode, 'minWidth' | 'maxWidth'>
): number | undefined {
  if (node.maxWidth == null) {
    return undefined
  }
  return Math.max(node.maxWidth, node.minWidth ?? 0)
}

export function getTextMeasurer(): TextMeasurer | null {
  return globalTextMeasurer
}

export function setTextMeasurer(measurer: TextMeasurer | null): void {
  globalTextMeasurer = measurer
}

/** The size of `node`'s text: measured when a measurer is installed and can, estimated otherwise. */
export function measureTextForLayout(
  node: SceneNode,
  maxWidth?: number
): { width: number; height: number } {
  return globalTextMeasurer?.(node, maxWidth) ?? estimateTextSize(node, maxWidth)
}

const installedMeasurers: TextMeasurer[] = []

/**
 * Makes `measurer` the layout text measurer until the returned function uninstalls it. Then
 * the most recent measurer still installed takes over, so closing one editor neither leaves
 * layout measuring with its destroyed renderer nor keeps that editor alive.
 */
export function installTextMeasurer(measurer: TextMeasurer): () => void {
  installedMeasurers.push(measurer)
  globalTextMeasurer = measurer
  return () => {
    const index = installedMeasurers.lastIndexOf(measurer)
    if (index !== -1) installedMeasurers.splice(index, 1)
    if (globalTextMeasurer === measurer) globalTextMeasurer = installedMeasurers.at(-1) ?? null
  }
}

/**
 * Run `fn` with `measurer` as the layout text measurer. The measurer is shared, so `fn` must
 * be synchronous: an override held across an await would leak into other layouts.
 */
export function withTextMeasurer<T>(measurer: TextMeasurer, fn: () => T): T {
  const previous = globalTextMeasurer
  globalTextMeasurer = measurer
  try {
    return fn()
  } finally {
    globalTextMeasurer = previous
  }
}
