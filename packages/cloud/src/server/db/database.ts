import type { Dialect, KyselyPlugin } from 'kysely'
import { CamelCasePlugin, Kysely } from 'kysely'

import type { CloudDatabase } from './tables'

export type CloudDatabaseOptions = {
  dialect: Dialect
  plugins?: readonly KyselyPlugin[]
}

export function createCloudDatabase(options: CloudDatabaseOptions): Kysely<CloudDatabase> {
  return new Kysely<CloudDatabase>({
    dialect: options.dialect,
    plugins: [new CamelCasePlugin(), ...(options.plugins ?? [])]
  })
}
