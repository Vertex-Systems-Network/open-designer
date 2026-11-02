import {
  loadAISigningKey,
  parseCloudDeploymentTOML,
  type AISigningKey,
  type CloudEnvironment,
  type CloudServerConfig
} from '#cloud/server'

import type { CollaborationRelayRPC } from './relay'

/** The bindings `deploy/cloudflare/wrangler.jsonc` gives the Worker and its relay objects. */
export type CloudflareCloudBindings = {
  /** PostgreSQL, through Hyperdrive, retained for local Cloudflare integration runs. */
  HYPERDRIVE?: Hyperdrive
  /** Turso/libSQL connection URL and token for the deployed Cloudflare Worker. */
  TURSO_URL?: string
  TURSO_AUTH_TOKEN?: string
  /** The collaboration relay, one object per document. */
  RELAY: DurableObjectNamespace<CollaborationRelayRPC>
  /** The built site, `dist-cloud`: the editor and the portal. */
  ASSETS: Fetcher
  /** Required by `[email] transport = "cloudflare"`. */
  EMAIL?: SendEmail
}

/** The bindings, plus the variables and secrets the deployment TOML names. */
export type CloudflareCloudEnvironment = CloudflareCloudBindings & Record<string, unknown>

export type PreparedCloudflareCloud = {
  config: CloudServerConfig
  aiSigningKey: AISigningKey | undefined
}

/** The Worker's string variables and secrets, with its database URL normalized for config parsing. */
function configEnvironment(env: CloudflareCloudEnvironment): CloudEnvironment {
  const databaseURL =
    env.HYPERDRIVE?.connectionString ??
    env.TURSO_URL ??
    (typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL : undefined)
  if (!databaseURL) throw new Error('[database] set TURSO_URL (or DATABASE_URL) for the Worker')
  if (!env.HYPERDRIVE && !env.TURSO_AUTH_TOKEN) {
    throw new Error('[database] TURSO_AUTH_TOKEN is required for the Turso Worker')
  }
  return {
    ...Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    DATABASE_URL: databaseURL
  }
}

/**
 * Reads the deployment TOML once per isolate: its config and AI signing key stay the same for the
 * Worker's lifetime. A failure is not kept, so the next request tries again.
 */
export function cloudflareCloudSetup(source: string) {
  let prepared: Promise<PreparedCloudflareCloud> | null = null
  return (env: CloudflareCloudEnvironment): Promise<PreparedCloudflareCloud> => {
    prepared ??= (async () => {
      const config = parseCloudDeploymentTOML(source, configEnvironment(env))
      return { config, aiSigningKey: await loadAISigningKey(config) }
    })().catch((error: unknown) => {
      prepared = null
      throw error
    })
    return prepared
  }
}
