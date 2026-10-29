import { describe, expect, test } from 'bun:test'

import { getNodeOrThrow } from '#core-tests/helpers/assert'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { sceneNodeToJSX, selectionToJSX } from '@open-pencil/design-jsx'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { setInstanceOverride } from '@open-pencil/scene-graph/instances/overrides'

const BUTTON = `<Frame name="Library">
  <Component name="Star" w={4} h={4} />
  <Component name="Heart" w={6} h={6} />
  <ComponentSet name="Button">
    <Component name="State=On" flex="row" bg="#3B6CF6">
      <Text name="Label" text={property('Label', 'Hi')} />
      <Frame name="Dot" w={4} h={4} bg="#FFFFFF" visible={property('Has dot', true)} />
      <Instance name="Icon" of={property('Icon', 'Star')} />
    </Component>
    <Component name="State=Off" flex="row" bg="#D0D4DA">
      <Text name="Label" text={property('Label', 'Hi')} />
      <Frame name="Dot" w={4} h={4} bg="#FFFFFF" visible={property('Has dot', true)} />
      <Instance name="Icon" of={property('Icon', 'Star')} />
    </Component>
  </ComponentSet>
</Frame>`

async function library() {
  const graph = new SceneGraph()
  const [frame] = await renderJSX(graph, BUTTON)
  return { graph, library: frame.id }
}

function named(graph: SceneGraph, name: string): SceneNode {
  const node = [...graph.getAllNodes()].find((item) => item.name === name)
  if (!node) throw new Error(`No layer named ${name}`)
  return node
}

function definitions(node: SceneNode) {
  return node.componentPropertyDefinitions.map(({ name, type, defaultValue }) => ({
    name,
    type,
    defaultValue
  }))
}

describe('component export', () => {
  test('writes bound fields as the property() calls that bind them', async () => {
    const { graph } = await library()
    const set = named(graph, 'Button')
    const jsx = sceneNodeToJSX(set.id, graph)
    expect(jsx).toContain('text={property("Label", "Hi")}')
    expect(jsx).toContain('visible={property("Has dot", true)}')
    expect(jsx).toContain('of={property("Icon", "Star")}')
    expect(jsx).not.toContain('propertyRefs')

    const page = graph.addPage('Copy')
    const [copy] = await renderJSX(graph, jsx, { parentId: page.id })
    const copied = getNodeOrThrow(graph, copy.id)
    expect(definitions(copied)).toEqual(definitions(set))
    expect(sceneNodeToJSX(copied.id, graph)).toBe(jsx)
  })

  test('writes an instance as its component, variant, and property values, not its layers', async () => {
    const { graph } = await library()
    const [instance] = await renderJSX(
      graph,
      '<Instance of="Button" State="Off" Label="Save" properties={{ "Has dot": false }} Icon="Heart" />'
    )
    const jsx = sceneNodeToJSX(instance.id, graph)
    expect(jsx).toBe(
      '<Instance name="State=Off" of="Button" State="Off" Label="Save" Icon="Heart" properties={{ "Has dot": false }} />'
    )

    const [copy] = await renderJSX(graph, jsx)
    const copied = getNodeOrThrow(graph, copy.id)
    expect(copied.componentId).toBe(getNodeOrThrow(graph, instance.id).componentId)
    expect(copied.componentPropertyAssignments).toEqual(
      getNodeOrThrow(graph, instance.id).componentPropertyAssignments
    )
    expect(sceneNodeToJSX(copied.id, graph)).toBe(jsx)
  })

  test('writes only the props an instance changes from its component', async () => {
    const { graph } = await library()
    const [instance] = await renderJSX(graph, '<Instance of="Button" x={40} bg="#000000" />')
    const jsx = sceneNodeToJSX(instance.id, graph)
    expect(jsx).toContain('x={40}')
    expect(jsx).toContain('bg="#000000"')
    expect(jsx).not.toContain('flex=')
  })

  test('writes what an instance changes in its layers as overrides', async () => {
    const { graph } = await library()
    const [created] = await renderJSX(graph, '<Instance of="Button" />')
    const instance = getNodeOrThrow(graph, created.id)
    const dot = graph.getChildren(instance.id).find((child) => child.name === 'Dot')
    if (!dot) throw new Error('No dot')
    const red = [{ ...dot.fills[0], color: { r: 1, g: 0, b: 0, a: 1 } }]
    graph.updateNode(dot.id, { fills: red, name: 'Red dot' })
    for (const field of ['fills', 'name'])
      setInstanceOverride(instance.instanceOverrides, instance.id, dot.id, field)

    const jsx = sceneNodeToJSX(instance.id, graph)
    expect(jsx).toContain('overrides={{')
    expect(jsx.indexOf('"Dot:fills"')).toBeLessThan(jsx.indexOf('"Dot:name"'))

    const [copy] = await renderJSX(graph, jsx)
    const copiedDot = graph.getChildren(copy.id).find((child) => child.name === 'Red dot')
    expect(copiedDot?.fills).toEqual(red)
    expect(sceneNodeToJSX(copy.id, graph)).toBe(jsx)
  })

  test('writes an override equal to the component value, so the layer keeps it', async () => {
    const { graph } = await library()
    const [created] = await renderJSX(graph, '<Instance of="Button" />')
    const instance = getNodeOrThrow(graph, created.id)
    const dot = graph.getChildren(instance.id).find((child) => child.name === 'Dot')
    if (!dot) throw new Error('No dot')
    setInstanceOverride(instance.instanceOverrides, instance.id, dot.id, 'opacity')

    const jsx = sceneNodeToJSX(instance.id, graph)
    expect(jsx).toContain('overrides={{ "Dot:opacity": 1 }}')
    const [copy] = await renderJSX(graph, jsx)
    const copiedDot = graph.getChildren(copy.id).find((child) => child.name === 'Dot')
    const claimed = getNodeOrThrow(graph, copy.id).instanceOverrides.descendants.get(copiedDot?.id ?? '')
    expect(claimed?.has('opacity')).toBe(true)
  })

  test('keeps the styling of text bound to a property', async () => {
    const graph = new SceneGraph()
    const [tag] = await renderJSX(
      graph,
      `<Component name="Tag"><Text name="Label" text={property('Label', 'Bold rest')}><Span weight={700}>Bold</Span> rest</Text></Component>`
    )
    const jsx = sceneNodeToJSX(tag.id, graph)
    expect(jsx).toContain('text={property("Label", "Bold rest")}')
    expect(jsx).toContain('<Span weight="bold">Bold</Span>')
    const [copy] = await renderJSX(graph, jsx)
    const label = (id: string) => graph.getChildren(id)[0]
    expect(label(copy.id)?.styleRuns).toEqual(label(tag.id)?.styleRuns)
    expect(sceneNodeToJSX(copy.id, graph)).toBe(jsx)
  })

  test('writes an instance as the frame it draws when it sets a property whose name is shared', async () => {
    const { graph } = await library()
    const set = named(graph, 'Button')
    const [created] = await renderJSX(graph, '<Instance of="Button" Label="Save" />')
    graph.updateNode(set.id, {
      componentPropertyDefinitions: set.componentPropertyDefinitions.map((definition) =>
        definition.type === 'BOOLEAN' ? { ...definition, name: 'Label' } : definition
      )
    })
    expect(sceneNodeToJSX(created.id, graph).startsWith('<Frame')).toBe(true)
  })

  test('writes an instance as the frame it draws when its changes cannot be written', async () => {
    const { graph } = await library()
    const [created] = await renderJSX(graph, '<Instance of="Button" />')
    const instance = getNodeOrThrow(graph, created.id)
    graph.updateNode(instance.id, { fills: [] })
    const jsx = sceneNodeToJSX(instance.id, graph)
    expect(jsx.startsWith('<Frame')).toBe(true)
    expect(jsx).not.toContain('property(')
    expect(jsx).toContain('<Instance name="Icon" of="Star" />')
  })

  test('names a component another graph can find, whatever is selected', async () => {
    const { graph, library: libraryId } = await library()
    const [instance] = await renderJSX(graph, '<Instance of="Button" Label="Go" />')
    expect(sceneNodeToJSX(instance.id, graph)).toContain('of="Button"')

    const target = new SceneGraph()
    const [copiedLibrary, copiedInstance] = await renderJSX(
      target,
      `<>${selectionToJSX([libraryId, instance.id], graph)}</>`
    )
    const variant = named(target, 'State=On')
    expect(getNodeOrThrow(target, copiedInstance.id).componentId).toBe(variant.id)
    expect(target.getChildren(copiedLibrary.id).length).toBe(3)
    const label = target.getChildren(copiedInstance.id).find((child) => child.name === 'Label')
    expect(label?.text).toBe('Go')
  })

  test('names a component by ID where its name is shared', async () => {
    const graph = new SceneGraph()
    const [first] = await renderJSX(graph, '<Component name="Card" w={10} h={10} />')
    await renderJSX(graph, '<Component name="Card" w={20} h={20} />')
    const [instance] = await renderJSX(graph, `<Instance of="${first.id}" />`)
    expect(sceneNodeToJSX(instance.id, graph)).toContain(`of="${first.id}"`)
  })

  test('names a component in the export by a ref where its name is shared', async () => {
    const graph = new SceneGraph()
    const [library] = await renderJSX(
      graph,
      `<Frame name="Library">
        <Component name="Card" w={10} h={10} />
        <Component name="Card" w={20} h={20} />
      </Frame>`
    )
    const [first] = graph.getChildren(library.id)
    const [instance] = await renderJSX(graph, `<Instance of="${first?.id}" />`)
    const jsx = selectionToJSX([instance.id, library.id], graph)
    expect(jsx).toContain('const card1 = ref()')
    expect(jsx).toContain('<Instance name="Card" of={card1} />')
    expect(jsx).toContain('<Component name="Card" w={10} h={10} ref={card1} />')

    const target = new SceneGraph()
    const [copiedInstance, copiedLibrary] = await renderJSX(target, jsx)
    expect(copiedInstance.warnings).toBeUndefined()
    const [copiedFirst] = target.getChildren(copiedLibrary.id)
    expect(getNodeOrThrow(target, copiedInstance.id).componentId).toBe(copiedFirst?.id)
    expect(selectionToJSX([copiedInstance.id, copiedLibrary.id], target)).toBe(jsx)
  })

  test('names a component ref apart from the variables the export declares', async () => {
    const graph = new SceneGraph()
    const [library] = await renderJSX(
      graph,
      `const tokens = defineVars('Card 1', { Accent: '#FF0000' })
      return <Frame name="Library" bg={tokens.Accent}>
        <Component name="Card" w={10} h={10} />
        <Component name="Card" w={20} h={20} />
      </Frame>`
    )
    const [first] = graph.getChildren(library.id)
    const [instance] = await renderJSX(graph, `<Instance of="${first?.id}" />`)
    const jsx = selectionToJSX([library.id, instance.id], graph)
    expect(jsx).toContain('const card1 = defineVars("Card 1"')
    expect(jsx).toContain('const card2 = ref()')

    const target = new SceneGraph()
    const [copiedLibrary, copiedInstance] = await renderJSX(target, jsx)
    const [copiedFirst] = target.getChildren(copiedLibrary.id)
    expect(getNodeOrThrow(target, copiedInstance.id).componentId).toBe(copiedFirst?.id)
  })

  test('renders an instance written before its component', async () => {
    const { graph, library: libraryId } = await library()
    const [instance] = await renderJSX(graph, '<Instance of="Button" />')
    const target = new SceneGraph()
    const [copiedInstance, copiedLibrary] = await renderJSX(
      target,
      `<>${selectionToJSX([instance.id, libraryId], graph)}</>`
    )
    expect(copiedInstance.type).toBe('INSTANCE')
    expect(copiedLibrary.type).toBe('FRAME')
    const page = target.getPages()[0]
    expect(target.getChildren(page.id).map((node) => node.type)).toEqual(['INSTANCE', 'FRAME'])
  })

  test('renders components before the roots that use them, however they name them', async () => {
    const graph = new SceneGraph()
    const [radio, swap, star] = await renderJSX(
      graph,
      `<>
        <Instance of="Radio" />
        <Component name="Swap"><Instance name="Icon" of={property('Icon', 'Star')} /></Component>
        <Component name="Star" w={4} h={4} />
        <RadioGroup.Item name="Radio" modelValue="Checked">
          <Component name="Checked=Off" w={20} h={20} />
          <Component name="Checked=On" w={20} h={20} />
        </RadioGroup.Item>
      </>`
    )
    expect(radio.type).toBe('INSTANCE')
    expect(graph.getChildren(swap.id)[0]?.componentId).toBe(star.id)
  })

  test('keeps a Reka text field binding its own text property', async () => {
    const graph = new SceneGraph()
    const [source] = await renderJSX(
      graph,
      '<TextField.Root name="Search"><TextField.Input name="Query" /></TextField.Root>'
    )
    const jsx = sceneNodeToJSX(source.id, graph)
    expect(jsx).not.toContain('property(')
    const [copy] = await renderJSX(graph, jsx)
    expect(definitions(getNodeOrThrow(graph, copy.id))).toEqual(
      definitions(getNodeOrThrow(graph, source.id))
    )
    expect(sceneNodeToJSX(copy.id, graph)).toBe(jsx)
  })
})
