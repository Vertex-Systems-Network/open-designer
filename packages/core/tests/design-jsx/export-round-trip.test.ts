import { describe, expect, it, test } from 'bun:test'

import { expectDefined, getNodeOrThrow } from '#core-tests/helpers/assert'
import { findByName, PROPERTY_CASES } from '#core-tests/helpers/property-cases'
import { pick } from 'es-toolkit'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { sceneNodeToJSX, selectionToJSX } from '@open-pencil/design-jsx'
import { SceneGraph } from '@open-pencil/scene-graph'
import { shaderOfPaint } from '@open-pencil/scene-graph/shaders'
import { claimSlotContent, slotScope } from '@open-pencil/scene-graph/slots'

describe('attribute string round-trip', () => {
  it.each([
    // Unescaped, this name would inject `w={999}` into the exported frame.
    'a" w={999} x="',
    'Fish &amp; chips',
    'Back\\slash',
    'Two\nlines',
    'Tab\there',
    'Plain name'
  ])('keeps the layer name %p', async (name) => {
    const g = new SceneGraph()
    const [source] = await renderJSX(g, '<Frame w={10} h={10} />')
    getNodeOrThrow(g, source.id).name = name
    const [result] = await renderJSX(g, sceneNodeToJSX(source.id, g))
    expect(getNodeOrThrow(g, result.id)).toMatchObject({ name, width: 10 })
  })
})

describe('text content round-trip', () => {
  it.each([
    'Curly {braces} and <tags>',
    'Fish &amp; chips',
    'Line one\nLine two',
    '  padded  ',
    'Back\\slash',
    'Tab\there'
  ])('keeps the text %p', async (text) => {
    const g = new SceneGraph()
    const [source] = await renderJSX(g, '<Text color="#000">Placeholder</Text>')
    getNodeOrThrow(g, source.id).text = text
    const [result] = await renderJSX(g, sceneNodeToJSX(source.id, g))
    expect(getNodeOrThrow(g, result.id).text).toBe(text)
  })
})

test('size limits are limits, not a width', async () => {
  const graph = new SceneGraph()
  const [defaultWidth] = await renderJSX(graph, '<Frame h={10} />')
  const [limited] = await renderJSX(graph, '<Frame h={10} maxW={400} />')
  const width = (id: string | undefined) => graph.getNode(expectDefined(id, 'frame'))?.width
  expect(graph.getNode(expectDefined(limited, 'frame').id)?.maxWidth).toBe(400)
  expect(width(limited?.id)).toBe(width(defaultWidth?.id))
})

describe('design JSX export round trip', () => {
  test('component sets keep property definitions and layer bindings', async () => {
    const graph = new SceneGraph()
    const [source] = await renderJSX(
      graph,
      `<ComponentSet name="Button" properties={[
  { id: "size", name: "Size", type: "VARIANT", defaultValue: "default", variantOptions: ["default", "sm"] },
  { id: "label", name: "Label", type: "TEXT", defaultValue: "Hi" },
  { id: "visible", name: "Visible", type: "BOOLEAN", defaultValue: "true" },
  { id: "content", name: "Content", type: "SLOT", defaultValue: "", slotSettings: { allowPreferredValuesOnly: false, displayEmptyByDefault: false, stretchChildOnInsert: false } }
]}>
  <Component name="Size=default">
    <Text name="Label" propertyRefs={[{ propertyId: "label", field: "TEXT" }]}>Hi</Text>
    <Frame name="Visible" propertyRefs={[{ propertyId: "visible", field: "VISIBLE" }]} />
    <Frame name="Content" propertyRefs={[{ propertyId: "content", field: "SLOT_CONTENT" }]} />
  </Component>
  <Component name="Size=sm">
    <Text name="Label" propertyRefs={[{ propertyId: "label", field: "TEXT" }]}>Hi</Text>
    <Frame name="Visible" propertyRefs={[{ propertyId: "visible", field: "VISIBLE" }]} />
    <Frame name="Content" propertyRefs={[{ propertyId: "content", field: "SLOT_CONTENT" }]} />
  </Component>
</ComponentSet>`
    )
    const sourceSet = getNodeOrThrow(graph, expectDefined(source, 'component set').id)
    const jsx = sceneNodeToJSX(sourceSet.id, graph)
    expect(jsx).toContain('<ComponentSet name="Button"')
    expect(jsx).toContain('properties={[')
    expect(jsx).toContain('propertyRefs={[')

    const target = graph.addPage('Rendered')
    const [rendered] = await renderJSX(graph, jsx, { parentId: target.id })
    const copy = getNodeOrThrow(graph, expectDefined(rendered, 'rendered component set').id)
    expect(copy.type).toBe('COMPONENT_SET')
    expect(copy.componentPropertyDefinitions).toEqual(sourceSet.componentPropertyDefinitions)

    const variant = expectDefined(
      graph.getChildren(copy.id).find((child) => child.type === 'COMPONENT'),
      'rendered variant'
    )
    const text = expectDefined(
      graph.getChildren(variant.id).find((child) => child.type === 'TEXT'),
      'rendered label'
    )
    expect(text).toMatchObject({
      text: 'Hi',
      componentPropertyReferences: [{ propertyId: 'label', field: 'TEXT' }]
    })
    expect(
      graph.getChildren(variant.id).find((child) => child.name === 'Visible')
        ?.componentPropertyReferences
    ).toEqual([{ propertyId: 'visible', field: 'VISIBLE' }])
    expect(
      graph.getChildren(variant.id).find((child) => child.name === 'Content')
        ?.componentPropertyReferences
    ).toEqual([{ propertyId: 'content', field: 'SLOT_CONTENT' }])
    expect(sceneNodeToJSX(copy.id, graph)).toBe(jsx)
  })

  test('instances retain their source component and property assignments', async () => {
    const graph = new SceneGraph()
    const [component] = await renderJSX(
      graph,
      `<Component name="Note" properties={[{ id: "label", name: "Label", type: "TEXT", defaultValue: "Hi" }]}>
  <Text propertyRefs={[{ propertyId: "label", field: "TEXT" }]}>Hi</Text>
</Component>`
    )
    const componentId = expectDefined(component, 'component').id
    const [source] = await renderJSX(
      graph,
      `<Instance of=${JSON.stringify(componentId)} properties={{ label: "Updated" }} />`
    )
    const instance = getNodeOrThrow(graph, expectDefined(source, 'instance').id)
    const jsx = sceneNodeToJSX(instance.id, graph)
    expect(jsx).toContain('<Instance')
    expect(jsx).toContain(`of="${componentId}"`)
    expect(jsx).toContain('properties={{ label: "Updated" }}')

    const target = graph.addPage('Rendered instance')
    const [rendered] = await renderJSX(graph, jsx, { parentId: target.id })
    const copy = getNodeOrThrow(graph, expectDefined(rendered, 'rendered instance').id)
    expect(copy.type).toBe('INSTANCE')
    expect(copy.componentPropertyAssignments).toEqual({ label: 'Updated' })
    expect(graph.getChildren(copy.id)[0]?.text).toBe('Updated')
    expect(sceneNodeToJSX(copy.id, graph)).toBe(jsx)
  })

  test('instances resolve an exported component in a fresh graph', async () => {
    const source = new SceneGraph()
    const [component] = await renderJSX(
      source,
      '<Component name="Note"><Text>Original</Text></Component>'
    )
    const [instance] = await renderJSX(source, `<Instance of=${JSON.stringify(component.id)} />`)
    const jsx = `<>${selectionToJSX([component.id, instance.id], source)}</>`

    const target = new SceneGraph()
    await renderJSX(target, '<Component name="Other"><Text>Other</Text></Component>')
    expect(target.getNode(component.id)).toBeUndefined()

    const [copy, copyInstance] = await renderJSX(target, jsx)
    expect(copy.type).toBe('COMPONENT')
    expect(copyInstance.type).toBe('INSTANCE')
    expect(copy.id).not.toBe(component.id)
    expect(getNodeOrThrow(target, copyInstance.id).componentId).toBe(copy.id)
    expect(target.getChildren(copyInstance.id)[0]?.text).toBe('Original')
  })

  test('instances restore owned and empty slot content without replacing default content', async () => {
    const graph = new SceneGraph()
    const slot = (id: string, name: string) => ({
      id,
      name,
      type: 'SLOT',
      defaultValue: '',
      slotSettings: {
        allowPreferredValuesOnly: false,
        displayEmptyByDefault: false,
        stretchChildOnInsert: false
      }
    })
    const [component] = await renderJSX(
      graph,
      `<Component name="Card" properties={[
  ${JSON.stringify(slot('content', 'Content'))},
  ${JSON.stringify(slot('empty', 'Empty'))},
  ${JSON.stringify(slot('default', 'Default'))}
]}>
  <Frame name="Content" propertyRefs={[{ propertyId: "content", field: "SLOT_CONTENT" }]}><Text>Original</Text></Frame>
  <Frame name="Empty" propertyRefs={[{ propertyId: "empty", field: "SLOT_CONTENT" }]}><Text>Remove me</Text></Frame>
  <Frame name="Default" propertyRefs={[{ propertyId: "default", field: "SLOT_CONTENT" }]}><Text>Keep me</Text></Frame>
</Component>`
    )
    const [instance] = await renderJSX(graph, `<Instance of=${JSON.stringify(component.id)} />`)
    const frame = (parentId: string, name: string) =>
      expectDefined(
        graph.getChildren(parentId).find((child) => child.name === name),
        name
      )
    const content = frame(instance.id, 'Content')
    const empty = frame(instance.id, 'Empty')

    for (const slotFrame of [content, empty]) {
      const scope = slotScope(graph, slotFrame.id)
      if (scope.kind !== 'slot')
        throw new Error(`Expected ${slotFrame.name} to be an instance slot`)
      claimSlotContent(graph, scope)
    }
    const editedText = expectDefined(graph.getChildren(content.id)[0], 'content text')
    graph.updateNode(editedText.id, { text: 'Edited content' })
    for (const child of graph.getChildren(empty.id)) graph.deleteNode(child.id)

    const jsx = sceneNodeToJSX(instance.id, graph)
    const targetPage = graph.addPage('Rendered')
    const [copy] = await renderJSX(graph, jsx, { parentId: targetPage.id })
    const copyContent = frame(copy.id, 'Content')
    const copyEmpty = frame(copy.id, 'Empty')
    const copyDefault = frame(copy.id, 'Default')

    expect(graph.getChildren(copyContent.id).map((child) => child.text)).toEqual(['Edited content'])
    expect(graph.getChildren(copyEmpty.id)).toEqual([])
    expect(graph.getChildren(copyDefault.id).map((child) => child.text)).toEqual(['Keep me'])
  })

  test('Reka inputs reuse their exported text-property reference', async () => {
    const graph = new SceneGraph()
    const [source] = await renderJSX(
      graph,
      '<TextField.Root name="Search"><TextField.Input name="Query" /></TextField.Root>'
    )
    const sourceNode = getNodeOrThrow(graph, source.id)
    const [sourceInput] = graph.getChildren(sourceNode.id)
    const jsx = sceneNodeToJSX(sourceNode.id, graph)
    const targetPage = graph.addPage('Rendered')
    const [copy] = await renderJSX(graph, jsx, { parentId: targetPage.id })
    const copyNode = getNodeOrThrow(graph, copy.id)
    const [copyInput] = graph.getChildren(copyNode.id)

    expect(copyNode.componentPropertyDefinitions).toEqual(sourceNode.componentPropertyDefinitions)
    expect(copyInput.componentPropertyReferences).toEqual(sourceInput.componentPropertyReferences)
    expect(sceneNodeToJSX(copy.id, graph)).toBe(jsx)
  })

  test.each(PROPERTY_CASES.map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    async (_, testCase) => {
      const graph = new SceneGraph()
      const source = expectDefined(graph.getPages()[0], 'source page')
      const target = graph.addPage('Rendered')
      const { rootId, target: targetName } = testCase.build(graph, source.id)

      const jsx = sceneNodeToJSX(rootId, graph)
      const [rendered] = await renderJSX(graph, jsx, { parentId: target.id })
      const renderedRoot = expectDefined(rendered, 'render result').id

      const original = findByName(graph, rootId, targetName)
      const copy = findByName(graph, renderedRoot, targetName)
      expect(pick(copy, testCase.fields)).toEqual(pick(original, testCase.fields))
      // Everything the export wrote comes back, so exporting the copy changes nothing.
      expect(sceneNodeToJSX(renderedRoot, graph)).toBe(jsx)
    }
  )
})

describe('shader paints', () => {
  test('a shader fill keeps its preset in the layer and exports as shader()', async () => {
    const graph = new SceneGraph()
    const [source] = await renderJSX(
      graph,
      "<Frame w={80} h={40} fills={[shader([{ type: 'Aurora', props: { speed: 2 } }], { opacity: 0.5 })]} />"
    )
    const node = getNodeOrThrow(graph, source.id)
    const [paint] = node.fills
    expect(paint).toMatchObject({ type: 'IMAGE', opacity: 0.5 })
    expect(paint).not.toHaveProperty('shader')
    expect(shaderOfPaint(node, paint)?.preset).toEqual({
      components: [{ type: 'Aurora', props: { speed: 2 } }]
    })

    const jsx = sceneNodeToJSX(source.id, graph)
    expect(jsx).toContain('shader([{ type: "Aurora", props: { speed: 2 } }], { opacity: 0.5 })')

    const [result] = await renderJSX(graph, jsx)
    const copy = getNodeOrThrow(graph, result.id)
    expect(shaderOfPaint(copy, copy.fills[0])?.preset).toEqual(shaderOfPaint(node, paint)?.preset)
  })

  test('a shader takes a preset as shaders.com exports it', async () => {
    const graph = new SceneGraph()
    const [source] = await renderJSX(
      graph,
      "<Frame w={10} h={10} bg={shader({ components: [{ type: 'Swirl' }], structureVersion: 2 })} />"
    )
    const node = getNodeOrThrow(graph, source.id)
    expect(shaderOfPaint(node, node.fills[0])?.preset.structureVersion).toBe(2)
  })

  test('a shader without effects says what it expects', async () => {
    const graph = new SceneGraph()
    await expect(renderJSX(graph, '<Frame bg={shader([])} />')).rejects.toThrow(
      /shader\(\) expects a preset/
    )
  })
})

describe('rich text round trip', () => {
  const RICH_FIELDS = ['text', 'styleRuns', 'textParagraphs'] as const

  async function expectRoundTrip(graph: SceneGraph, id: string) {
    const jsx = sceneNodeToJSX(id, graph)
    const [result] = await renderJSX(graph, jsx)
    const copy = getNodeOrThrow(graph, expectDefined(result, 'render result').id)
    expect(pick(copy, RICH_FIELDS)).toEqual(pick(getNodeOrThrow(graph, id), RICH_FIELDS))
    expect(sceneNodeToJSX(copy.id, graph)).toBe(jsx)
  }

  test('spans and paragraphs written as JSX come back the same', async () => {
    const graph = new SceneGraph()
    const [source] = await renderJSX(
      graph,
      `<Text size={24} color="#111111" lineHeight={30} paragraphSpacing={6} textDecorationColor="#2222EE">
  <Paragraph list="unordered" indent={2}>Auto <Span lineHeight="auto" textDecoration="underline" textDecorationStyle="dotted" textDecorationColor="currentColor" textDecorationThickness={3} textUnderlineOffset="auto" textDecorationSkipInk={false}>underlined</Span> <Span fills={[]}>hidden</Span></Paragraph>
  <Paragraph spacing={12}>Hello <Span weight={700} color="#EE2222">bold <Span italic>world</Span></Span>!</Paragraph>
  <Paragraph list="ordered">First <Span textDecoration="underline" letterSpacing={1}>item</Span></Paragraph>
  <Paragraph list="ordered" level={2} listSpacing={4} indent={8}>Nested</Paragraph>
  <Paragraph list="unordered"><Span size={18} font="Roboto" lineHeight={28}>Dot</Span> <Span fontFeatures={{ tnum: true, liga: false }} fontVariations={{ wght: 650 }} lang="de">0123</Span></Paragraph>
  <Paragraph />
</Text>`
    )
    const node = getNodeOrThrow(graph, expectDefined(source, 'render result').id)
    expect(node.styleRuns.length).toBeGreaterThan(0)
    expect(node.textParagraphs).toHaveLength(5)
    await expectRoundTrip(graph, node.id)
  })

  test('styled text from the scene exports and renders back the same', async () => {
    const graph = new SceneGraph()
    const [source] = await renderJSX(graph, '<Text color="#000">Placeholder</Text>')
    const id = expectDefined(source, 'render result').id
    graph.updateNode(id, {
      text: 'Plain {braces} bold\nnext line',
      styleRuns: [
        { start: 15, length: 5, style: { fontWeight: 700 } },
        { start: 20, length: 4, style: { fontSize: 20 } }
      ]
    })
    await expectRoundTrip(graph, id)
  })
})
