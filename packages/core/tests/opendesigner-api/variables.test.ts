import { expect, test } from 'bun:test'

import { OpenDesignerAPI } from '@open-designer/core/opendesigner-api'
import { FigmaAPI } from '@open-designer/core/figma-api'
import { compileScript } from '@open-designer/core/tools'
import { SceneGraph } from '@open-designer/scene-graph'

function document() {
  const graph = new SceneGraph()
  const collection = graph.createCollection('Copy')
  graph.createVariable('price', 'FLOAT', collection.id, 42.5)
  graph.createVariable('state', 'STRING', collection.id, 'off')
  return { graph, figma: new FigmaAPI(graph) }
}

test('scripts bind what the layer panel binds, beyond Figma’s setBoundVariable', async () => {
  const { graph, figma } = document()
  const result = await compileScript(`
    const [price, state] = figma.variables.getLocalVariables()
    const label = figma.createText()
    opendesigner.bindVariable(label, 'text', price)
    opendesigner.bindVariable(label, 'visible', state)
    return { id: label.id, figmaBinds: 'bindVariable' in figma }
  `)(figma)
  const { id, figmaBinds } = result as { id: string; figmaBinds: boolean }
  expect(figmaBinds).toBe(false)
  expect(graph.getNode(id)).toMatchObject({ text: '42.50', visible: false })
})

test('unbinding keeps the value the variable last gave, and errors name the layer', async () => {
  const { graph, figma } = document()
  const id = (await compileScript(`
    const label = figma.createText()
    label.name = 'Label'
    opendesigner.bindVariable(label, 'text', figma.variables.getLocalVariables()[0])
    opendesigner.unbindVariable(label, 'text')
    return label.id
  `)(figma)) as string
  expect(graph.getNode(id)).toMatchObject({ text: '42.50', boundVariables: {} })
  await expect(
    compileScript(`opendesigner.unbindVariable(${JSON.stringify(id)}, 'text')`)(figma)
  ).rejects.toThrow('Label has no variable bound to text')
  await expect(
    compileScript(
      `opendesigner.bindVariable(${JSON.stringify(id)}, 'text', figma.variables.getLocalVariables()[1]); opendesigner.bindVariable(${JSON.stringify(id)}, 'fontFamily', figma.variables.getLocalVariables()[0])`
    )(figma)
  ).rejects.toThrow('Cannot bind FLOAT variable to string field "fontFamily"')
})

test('unbinding a paint keeps the color its variable last gave it', () => {
  const graph = new SceneGraph()
  const collection = graph.createCollection('Colors')
  const brand = graph.createVariable('brand', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 })
  const figma = new FigmaAPI(graph)
  const rect = figma.createRectangle()
  const black = { type: 'SOLID' as const, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }
  rect.fills = [black]
  const opendesigner = new OpenDesignerAPI(figma)
  opendesigner.bindVariable(rect, 'fills/0/color', brand)
  opendesigner.unbindVariable(rect, 'fills/0/color')
  expect(graph.getNode(rect.id)?.fills[0]?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
})
