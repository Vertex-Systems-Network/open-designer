import { describe, expect, test } from 'bun:test'

import { getNodeOrThrow } from '#core-tests/helpers/assert'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { sceneNodeToJSX } from '@open-pencil/design-jsx'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('component rendering', () => {
  test('rejects a variant value the set does not have', async () => {
    const graph = new SceneGraph()
    await renderJSX(
      graph,
      '<ComponentSet name="Button"><Component name="State=On" /><Component name="State=Off" /></ComponentSet>'
    )
    await expect(renderJSX(graph, '<Instance of="Button" State="Nope" />')).rejects.toThrow(
      'Button has no variant State=Nope'
    )
  })

  test('takes a variant prop set to undefined as no choice', async () => {
    const graph = new SceneGraph()
    const [set] = await renderJSX(
      graph,
      '<ComponentSet name="Button"><Component name="State=On" /><Component name="State=Off" /></ComponentSet>'
    )
    const [instance] = await renderJSX(graph, '<Instance of="Button" State={undefined} />')
    expect(getNodeOrThrow(graph, instance.id).componentId).toBe(graph.getChildren(set.id)[0]?.id)
  })

  test('runs renders into one graph one after another, so a failure undoes only its own', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const [failed, rendered] = await Promise.allSettled([
      renderJSX(graph, '<><Frame name="A" /><Instance of="Missing" /></>'),
      renderJSX(graph, '<Frame name="B" />')
    ])
    expect(failed?.status).toBe('rejected')
    expect(rendered?.status).toBe('fulfilled')
    expect(graph.getChildren(page.id).map((node) => node.name)).toEqual(['B'])
  })

  test('undoes a render whose steps after drawing fail, and the variables it defined', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    await expect(
      renderJSX(graph, '<Frame name="X" />', {
        onNode: () => {
          throw new Error('boom')
        }
      })
    ).rejects.toThrow('boom')
    expect(graph.getChildren(page.id)).toEqual([])
    await expect(
      renderJSX(
        graph,
        `const theme = defineVars('Theme', { Accent: '#FF0000' })
        return <><Frame bg={theme.Accent} /><Instance of="Missing" /></>`
      )
    ).rejects.toThrow('component not found')
    expect(graph.variableCollections.size).toBe(0)
    expect(graph.variables.size).toBe(0)
  })

  test('rejects an instance that would put its component inside itself', async () => {
    const graph = new SceneGraph()
    await expect(
      renderJSX(graph, '<Component name="Loop"><Instance of="Loop" /></Component>')
    ).rejects.toThrow('would put the component inside itself')
    expect(graph.getChildren(graph.getPages()[0].id)).toEqual([])
  })

  test('undoes the properties a failed render added to the component it renders into', async () => {
    const graph = new SceneGraph()
    const [card] = await renderJSX(
      graph,
      '<><Component name="Tile" w={4} h={4} /><Component name="Card" /></>'
    ).then((results) => results.slice(1))
    await expect(
      renderJSX(
        graph,
        `<Instance of="Tile" visible={property('Shown', true)} properties={{ Missing: 'x' }} />`,
        { parentId: card.id }
      )
    ).rejects.toThrow('Unknown component property: Missing')
    expect(getNodeOrThrow(graph, card.id).componentPropertyDefinitions).toEqual([])
    await renderJSX(graph, `<Frame visible={property('Shown', false)} />`, { parentId: card.id })
    expect(getNodeOrThrow(graph, card.id).componentPropertyDefinitions).toHaveLength(1)
  })

  test('rejects a variant property named like another property of the set', async () => {
    const graph = new SceneGraph()
    await expect(
      renderJSX(
        graph,
        `<ComponentSet name="Badge"><Component name="State=On"><Text text={property('State', 'x')} /></Component></ComponentSet>`
      )
    ).rejects.toThrow('Variant property State of Badge has the name of its TEXT property')
  })

  test('keeps a layer prop its meaning when a variant property shares its name', async () => {
    const graph = new SceneGraph()
    await renderJSX(
      graph,
      '<ComponentSet name="Eye"><Component name="visible=true" w={4} h={4} /><Component name="visible=false" w={8} h={8} /></ComponentSet>'
    )
    // `visible` hides the instance; it does not pick the visible=false variant.
    const [hidden] = await renderJSX(graph, '<Instance of="Eye" visible={false} />')
    expect(getNodeOrThrow(graph, hidden.id).visible).toBe(false)
    expect(getNodeOrThrow(graph, hidden.id).width).toBe(4)
    const [chosen] = await renderJSX(graph, '<Instance of="visible=false" />')
    expect(getNodeOrThrow(graph, chosen.id).width).toBe(8)
  })

  test('orders components inside Reka parts before the elements that name them', async () => {
    const graph = new SceneGraph()
    const [root] = await renderJSX(
      graph,
      `<Tabs.Root name="Tabs">
        <Tabs.Content name="First"><Instance name="Copy" of="Tile" /><Component name="Tile" w={4} h={4} /></Tabs.Content>
        <Tabs.Content name="Second" />
      </Tabs.Root>`
    )
    const panels = [...graph.getAllNodes()].filter(
      (node) => node.name === 'First' || node.name === 'Second'
    )
    expect(panels.map((panel) => panel.visible)).toEqual([true, false])
    const first = panels[0]
    expect(graph.getChildren(first?.id ?? '').map((child) => child.type)).toEqual([
      'INSTANCE',
      'COMPONENT'
    ])
    expect(root.type).toBe('COMPONENT')
  })

  test('orders a component an exposed instance value names before the instance', async () => {
    const graph = new SceneGraph()
    const results = await renderJSX(
      graph,
      `<>
        <Component name="Star" w={4} h={4} />
        <Instance of="Card" Action={{ Icon: 'Arrow' }} />
        <Component name="Button"><Instance name="Icon" of={property('Icon', 'Star')} /></Component>
        <Component name="Card"><Instance name="Action" of="Button" exposed /></Component>
        <Component name="Arrow" w={4} h={4} />
      </>`
    )
    const arrow = results[4]
    const action = graph.getChildren(results[1].id)[0]
    const icon = graph.getChildren(action?.id ?? '')[0]
    expect(icon?.componentId).toBe(arrow.id)
  })

  test('binds and writes back the visibility of an element that draws its own layer', async () => {
    const graph = new SceneGraph()
    const [note] = await renderJSX(
      graph,
      `<Component name="Note"><Sticky visible={property('Shown', true)}>Hi</Sticky></Component>`
    )
    const [definition] = getNodeOrThrow(graph, note.id).componentPropertyDefinitions
    expect(definition).toMatchObject({ name: 'Shown', type: 'BOOLEAN' })
    const sticky = graph.getChildren(note.id)[0]
    expect(sticky?.componentPropertyReferences).toEqual([
      { propertyId: definition?.id, field: 'VISIBLE' }
    ])
    const jsx = sceneNodeToJSX(note.id, graph)
    expect(jsx).toContain('visible={property("Shown", true)}')
    const [copy] = await renderJSX(graph, jsx)
    expect(sceneNodeToJSX(copy.id, graph)).toBe(jsx)
  })
})
