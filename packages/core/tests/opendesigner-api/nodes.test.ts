import { expect, test } from 'bun:test'

import { OpenDesignerAPI } from '@open-designer/core/opendesigner-api'
import { FigmaAPI } from '@open-designer/core/figma-api'
import { compileScript } from '@open-designer/core/tools'
import { SceneGraph } from '@open-designer/scene-graph'

test('scripts set layout and text direction through opendesigner, which figma lacks', async () => {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const result = (await compileScript(`
    const frame = figma.createFrame()
    const text = figma.createText()
    const before = opendesigner.getLayoutDirection(frame)
    opendesigner.setLayoutDirection(frame, 'RTL')
    opendesigner.setTextDirection(text, 'RTL')
    return {
      before,
      layout: opendesigner.getLayoutDirection(frame),
      text: opendesigner.getTextDirection(text),
      onFigma: 'layoutDirection' in frame || 'textDirection' in text
    }
  `)(figma)) as { before: string; layout: string; text: string; onFigma: boolean }
  expect(result).toEqual({ before: 'AUTO', layout: 'RTL', text: 'RTL', onFigma: false })
  await expect(
    compileScript(`opendesigner.setTextDirection(figma.createText(), 'UP')`)(figma)
  ).rejects.toThrow('Unknown direction UP; use AUTO, LTR, RTL')
})

test('a layer saved without a layout direction reads AUTO', () => {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const frame = figma.createFrame()
  Reflect.deleteProperty(graph.getNode(frame.id) as object, 'layoutDirection')
  expect(new OpenDesignerAPI(figma).getLayoutDirection(frame)).toBe('AUTO')
})
