import { compositeOver, readableForeground } from '@open-designer/scene-graph/color'
import { WHITE } from '@open-designer/scene-graph/constants'
import type { Color } from '@open-designer/scene-graph/primitives'

export function canvasLabelForeground(background: Color, canvasBackground: Color = WHITE): Color {
  return readableForeground(compositeOver(background, canvasBackground))
}
