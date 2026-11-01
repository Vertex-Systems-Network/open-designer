import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

import type { Editor } from '@open-designer/core'

/**
 * Injection key for the current OpenDesigner editor instance.
 *
 * Most SDK consumers should use {@link provideEditor} and {@link useEditor}
 * instead of interacting with this symbol directly.
 */
export const EDITOR_KEY: InjectionKey<Editor> = Symbol('open-designer-editor')

/**
 * Provides an OpenDesigner editor instance to the current Vue subtree.
 *
 * Call this once near the top of your editor shell so descendant composables
 * and headless primitives can access the editor with {@link useEditor}.
 */
export function provideEditor(editor: Editor) {
  provide(EDITOR_KEY, editor)
}

/**
 * Returns the current injected OpenDesigner editor.
 *
 * Throws if called outside a subtree where {@link provideEditor} has already
 * been called.
 */
export function useEditor(): Editor {
  const editor = inject(EDITOR_KEY)
  if (!editor) {
    throw new Error(
      '[open-designer] useEditor() called without an injected editor. ' +
        'Call provideEditor(editor) near the top of your Vue subtree first.'
    )
  }
  return editor
}
