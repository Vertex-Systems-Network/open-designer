import { createLibsqlCloudDatabase } from '#cloud/runtime/libsql/database'
import { createBetterAuthAdapter, migrateCloudDatabase } from '#cloud/server'

import { loadNodeCloudServerConfig } from './config'

const url = process.env.TURSO_URL ?? process.env.DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url) throw new Error('TURSO_URL is required')
if (!authToken) throw new Error('TURSO_AUTH_TOKEN is required')

const config = await loadNodeCloudServerConfig({ ...process.env, DATABASE_URL: url })
const database = await createLibsqlCloudDatabase({ url, authToken })
try {
  const auth = createBetterAuthAdapter(config, database)
  await migrateCloudDatabase(
    database,
    { run: auth.migrate, schemaVersion: auth.schemaVersion },
    { dialect: 'libsql' }
  )
} finally {
  await database.destroy()
}
