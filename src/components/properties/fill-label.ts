import type { Fill, Variable } from '@open-designer/scene-graph'
import { colorToHexRaw } from '@open-designer/scene-graph/color'
import type { ShaderPaint } from '@open-designer/scene-graph/shaders'
import { shaderEffectLabel } from '@open-designer/vue/controls/shader'

export function fillLabel(
  fill: Fill,
  boundVariable?: Variable,
  shader?: ShaderPaint | null
): string {
  if (boundVariable) return boundVariable.name
  // A shader is named by its effects, top first, as its picker lists them.
  if (shader)
    return shader.preset.components
      .map((component) => shaderEffectLabel(component.type))
      .reverse()
      .join(', ')
  if (fill.type === 'SOLID') return colorToHexRaw(fill.color)
  if (fill.type.startsWith('GRADIENT')) return fill.type.replace('GRADIENT_', '')
  return fill.type
}
