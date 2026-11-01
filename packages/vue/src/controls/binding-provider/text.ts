import type { Editor } from '@open-designer/core'
import { TEXT_CONTENT_VARIABLE_TYPES, variableText } from '@open-designer/scene-graph/variables'

import { useOpenDesignerBindingProvider } from '#vue/controls/binding-provider/open-designer'
import type { BindingTarget } from '#vue/controls/binding-provider/types'

/** What a variable shows as a text layer's content: text as it is, a number formatted as text. */
function resolveTextContent(editor: Editor, id: string, target?: BindingTarget) {
  return variableText(
    target
      ? editor.graph.resolveVariableForNode(target.nodeId, id)
      : editor.graph.resolveVariable(id)
  )
}

/** Binds a text layer's content to a text or number variable, as Figma's layer panel does. */
export function useTextContentBindingProvider() {
  return useOpenDesignerBindingProvider<string>({
    types: TEXT_CONTENT_VARIABLE_TYPES,
    resolve: resolveTextContent
  })
}
