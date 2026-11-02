import type { AICatalog } from '@open-designer/cloud/contract'
import type { ModelOption } from '@open-designer/core/constants'

/** The models Cloud's AI service offers, as the model picker lists them. */
export function cloudCatalogModels(catalog: AICatalog): ModelOption[] {
  return catalog.models.map((model) => ({
    id: model.id,
    name: model.label,
    capabilities: [
      ...(model.capabilities.tools ? (['tools'] as const) : []),
      ...(model.capabilities.vision ? (['vision'] as const) : [])
    ]
  }))
}
