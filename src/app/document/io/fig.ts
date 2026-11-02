import { readFigFile } from '@open-designer/core/io/formats/fig'
import type { SceneGraph } from '@open-designer/scene-graph'
import { isUnsupportedVariableValue } from '@open-designer/scene-graph/variables'

import { notificationMessages } from '@/app/i18n/notifications'
import { toast } from '@/app/shell/ui'

export async function readFigDocument(file: File, signal?: AbortSignal) {
  const graph = await readFigFile(file, {
    populate: 'first-page',
    signal
  })
  warnUnsupportedVariableExpressions(graph)
  return graph
}

/** Names the variables whose expressions OpenDesigner cannot evaluate, which draw as saved. */
function warnUnsupportedVariableExpressions(graph: SceneGraph) {
  const names = [...graph.variables.values()]
    .filter((variable) => Object.values(variable.valuesByMode).some(isUnsupportedVariableValue))
    .map((variable) => variable.name)
  if (names.length === 0) return
  toast.warning(
    notificationMessages.get().unsupportedVariableExpressions({ names: names.join(', ') })
  )
}
