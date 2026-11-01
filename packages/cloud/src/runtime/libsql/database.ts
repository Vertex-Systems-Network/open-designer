import { createCloudDatabase } from '#cloud/server'
import { sql } from 'kysely'
import { LibsqlDialect } from 'kysely-libsql'

import { LibsqlCloudPlugin } from './plugin'

export type LibsqlCloudDatabaseOptions = {
  url: string
  authToken: string
}

/** Creates the Cloud query layer over Turso/libSQL and enables SQLite foreign-key actions. */
export async function createLibsqlCloudDatabase(options: LibsqlCloudDatabaseOptions) {
  const database = createCloudDatabase({
    dialect: new LibsqlDialect({ url: options.url, authToken: options.authToken }),
    plugins: [new LibsqlCloudPlugin()]
  })
  try {
    await sql`pragma foreign_keys = on`.execute(database)
    return database
  } catch (error) {
    await database.destroy()
    throw error
  }
}
