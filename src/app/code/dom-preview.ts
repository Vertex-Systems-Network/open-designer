import { sceneGraphFromStyledHTML } from '@open-pencil/core/io/formats/html/layers'
import {
  browserHTMLToDesignDocument,
  browserTailwindHTMLToDesignDocument
} from '@open-pencil/dom-css/browser'
import type { ComponentStyling } from '@open-pencil/dom-css/export'
import type { SceneGraph } from '@open-pencil/scene-graph'
import type { UndoHistorySnapshot } from '@open-pencil/scene-graph/undo'

import type { EditorStore } from '@/app/editor/active-store'

export type DOMCodeSession = {
  originalGraph: SceneGraph
  originalPageId: string
  previewGraph: SceneGraph | null
  previewPageId: string | null
  undoHistory: UndoHistorySnapshot | null
}

export function createDOMCodeSession(store: EditorStore): DOMCodeSession {
  return {
    originalGraph: store.graph,
    originalPageId: store.state.currentPageId,
    previewGraph: null,
    previewPageId: null,
    undoHistory: null
  }
}

/** Every class the markup names, which Tailwind builds its utilities for. */
function classNames(html: string): string[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  return [...parsed.querySelectorAll('[class]')].flatMap((element) => [...element.classList])
}

/** Tailwind's own stylesheet, loaded with the first Tailwind preview rather than with the app. */
async function loadTailwindStylesheet(): Promise<string> {
  const { default: css } = await import('tailwindcss/index.css?raw')
  return css
}

async function designDocument(source: string, styling: ComponentStyling) {
  if (styling === 'css') return browserHTMLToDesignDocument(source)
  return browserTailwindHTMLToDesignDocument(source, classNames(source), {
    loadStylesheet: loadTailwindStylesheet
  })
}

export async function previewDOMCode(
  store: EditorStore,
  session: DOMCodeSession,
  source: string,
  styling: ComponentStyling
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const graph = sceneGraphFromStyledHTML(await designDocument(source, styling), {
      pageName: 'Code preview'
    })
    const pageId = graph.getPages()[0]?.id ?? graph.rootId
    session.previewGraph = graph
    session.previewPageId = pageId
    if (!session.undoHistory) {
      session.undoHistory = store.captureUndoHistory()
      store.clearUndoHistory()
    }
    store.replaceGraph(graph, { preserveHistory: true })
    return { ok: true }
  } catch (error) {
    if (session.undoHistory) {
      store.restoreUndoHistory(session.undoHistory)
      session.undoHistory = null
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function resetDOMCodePreview(store: EditorStore, session: DOMCodeSession): void {
  store.replaceGraph(session.originalGraph, { preserveHistory: true })
  if (session.undoHistory) store.restoreUndoHistory(session.undoHistory)
  session.undoHistory = null
  void store.switchPage(session.originalPageId)
  session.previewGraph = null
  session.previewPageId = null
}

export function commitDOMCodeSession(store: EditorStore, session: DOMCodeSession): void {
  const after = session.previewGraph
  const afterPageId = session.previewPageId
  if (!after || !afterPageId) return
  if (session.undoHistory) store.restoreUndoHistory(session.undoHistory, false)
  session.undoHistory = null
  store.pushUndoEntry({
    label: 'Edit HTML/CSS',
    forward: () => {
      store.replaceGraph(after, { preserveHistory: true })
      void store.switchPage(afterPageId)
    },
    inverse: () => {
      store.replaceGraph(session.originalGraph, { preserveHistory: true })
      void store.switchPage(session.originalPageId)
    }
  })
}
