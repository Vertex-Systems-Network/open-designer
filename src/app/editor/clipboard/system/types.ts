import type { ClipboardPayload, CopyOptions } from '@open-designer/core'
import type { Vector } from '@open-designer/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'
export type { ClipboardPayload } from '@open-designer/core'

export interface SystemClipboard {
  copy(store: EditorStore, options?: CopyOptions): Promise<boolean>
  paste(store: EditorStore, cursorPos?: Vector): Promise<boolean>
}

export type BrowserClipboardReadResult =
  | { available: false }
  | { available: true; html: string | null; text: string | null }

export interface BrowserClipboardIO {
  write(payload: Promise<ClipboardPayload>): Promise<boolean>
  read(): Promise<BrowserClipboardReadResult>
}
