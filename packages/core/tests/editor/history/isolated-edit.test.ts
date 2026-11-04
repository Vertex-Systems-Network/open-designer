import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-designer/core'

import { editOnIsolatedPage } from '#core/editor/history/isolated-edit'

function gate() {
  let start!: () => void
  let finish!: () => void
  const started = new Promise<void>((resolve) => {
    start = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { started, waiting, start, finish }
}

describe('isolated asynchronous page edits', () => {
  test('commits its rendered nodes without replacing concurrent user changes', async () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const existing = editor.graph.createNode('RECTANGLE', pageId, { name: 'Existing' })
    const pause = gate()
    let renderedId = ''

    const rendering = editOnIsolatedPage(editor.graph, pageId, async (draft) => {
      renderedId = draft.createNode('RECTANGLE', pageId, { name: 'Rendered' }).id
      pause.start()
      await pause.waiting
      return renderedId
    })

    await pause.started
    editor.graph.updateNode(existing.id, { name: 'Changed during render' })
    const concurrent = editor.graph.createNode('RECTANGLE', pageId, { name: 'User layer' })
    pause.finish()

    expect(await rendering).toBe(renderedId)
    expect(editor.graph.getNode(existing.id)?.name).toBe('Changed during render')
    expect(editor.graph.getNode(concurrent.id)?.name).toBe('User layer')
    expect(editor.graph.getNode(renderedId)?.name).toBe('Rendered')
  })

  test('discards a failed render and preserves concurrent edits and new layers', async () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const existing = editor.graph.createNode('RECTANGLE', pageId, { name: 'Existing' })
    const pause = gate()
    let partialId = ''
    const rendering = editOnIsolatedPage(editor.graph, pageId, async (draft) => {
      partialId = draft.createNode('RECTANGLE', pageId, { name: 'Partial render' }).id
      pause.start()
      await pause.waiting
      throw new Error('render failed')
    })

    await pause.started
    editor.graph.updateNode(existing.id, { name: 'Concurrent edit' })
    const concurrent = editor.graph.createNode('RECTANGLE', pageId, { name: 'Concurrent layer' })
    pause.finish()

    await expect(rendering).rejects.toThrow('render failed')
    expect(editor.graph.getNode(existing.id)?.name).toBe('Concurrent edit')
    expect(editor.graph.getNode(concurrent.id)?.name).toBe('Concurrent layer')
    expect(editor.graph.getNode(partialId)).toBeUndefined()
  })
})
