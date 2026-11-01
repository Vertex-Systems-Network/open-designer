import type { AIProviderID } from '@open-designer/core/constants'

/**
 * The provider whose models a Cloud workspace's plan pays for, through the AI service the Home
 * server advertises. Its catalog, not the provider definition, names the models.
 */
export const OPENDESIGNER_AI_PROVIDER = 'opendesigner' as const satisfies AIProviderID
