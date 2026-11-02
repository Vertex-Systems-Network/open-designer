import { createLibsqlCloudDatabase } from '#cloud/runtime/libsql/database'
import { createPostgresCloudDatabase } from '#cloud/runtime/postgres/database'

import type { CloudflareCloudEnvironment } from './environment'

/** Selects Turso for deployed Workers while keeping Hyperdrive available to local E2E runs. */
export function createCloudflareDatabase(env: CloudflareCloudEnvironment, databaseURL: string) {
  if (env.HYPERDRIVE) {
    return Promise.resolve(createPostgresCloudDatabase({ connectionString: databaseURL }))
  }
  if (!env.TURSO_AUTH_TOKEN) {
    throw new Error('[database] TURSO_AUTH_TOKEN is required for the Turso Worker')
  }
  return createLibsqlCloudDatabase({ url: databaseURL, authToken: env.TURSO_AUTH_TOKEN })
}
