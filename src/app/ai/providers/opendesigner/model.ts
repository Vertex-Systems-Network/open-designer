import type { CloudAIClient } from '@open-designer/cloud/client'

import type { ModelConfig, ModelProviderRuntime } from '@/app/ai/providers/types'

import { OPENDESIGNER_AI_PROVIDER } from './provider'

/**
 * A model on Cloud's AI service. The service authorizes with Cloud's token, which the client's
 * fetch adds to every request, so the key is only a placeholder the SDK requires.
 */
export function cloudModelConfig(
  client: CloudAIClient,
  modelID: string
): { config: ModelConfig; runtime: ModelProviderRuntime } {
  return {
    config: {
      providerID: OPENDESIGNER_AI_PROVIDER,
      apiKey: 'opendesigner-cloud',
      modelID,
      customModelID: '',
      customBaseURL: client.modelBaseURL,
      customAPIType: 'completions'
    },
    runtime: { fetch: client.fetch }
  }
}
