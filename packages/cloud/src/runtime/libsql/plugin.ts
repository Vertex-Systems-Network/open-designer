import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow
} from 'kysely'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toLibsqlValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 1 : 0
  if (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Uint8Array) &&
    !(value instanceof ArrayBuffer) &&
    !(value instanceof DataView)
  ) {
    return JSON.stringify(value)
  }
  return value
}

function transformNode(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof DataView) {
    return value
  }
  if (Array.isArray(value)) return value.map(transformNode)
  if (!isRecord(value)) return value

  if (value.kind === 'ValueNode' && 'value' in value) {
    return { ...value, value: toLibsqlValue(value.value) }
  }

  const transformed = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, transformNode(child)])
  )
  if (value.kind === 'SelectQueryNode' && Array.isArray(transformed.endModifiers)) {
    transformed.endModifiers = transformed.endModifiers.filter(
      (modifier) =>
        !isRecord(modifier) ||
        modifier.kind !== 'SelectModifierNode' ||
        (modifier.modifier !== 'ForUpdate' && modifier.modifier !== 'SkipLocked')
    )
  }
  return transformed
}

function transformRow(row: UnknownRow): UnknownRow {
  const transformed: Record<string, unknown> = { ...row }
  for (const [key, value] of Object.entries(transformed)) {
    if (value === null || value === undefined) continue
    if (key.endsWith('At') && typeof value === 'string') {
      const timestamp = /^\d{4}-\d\d-\d\d \d/.test(value) ? `${value.replace(' ', 'T')}Z` : value
      transformed[key] = new Date(timestamp)
    } else if (
      ['backedUp', 'verified', 'emailVerified', 'twoFactorEnabled', 'banned'].includes(key) &&
      (value === 0 || value === 1)
    ) {
      transformed[key] = value === 1
    } else if ((key === 'metadata' || key === 'values') && typeof value === 'string') {
      try {
        transformed[key] = JSON.parse(value) as unknown
      } catch {
        // Leave an unexpected database value intact so the caller can report the schema problem.
      }
    } else if (value instanceof ArrayBuffer) {
      transformed[key] = new Uint8Array(value)
    }
  }
  return transformed
}

/** Adapts PostgreSQL-oriented query values and row locks to SQLite/libSQL semantics. */
export class LibsqlCloudPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return transformNode(args.node) as RootOperationNode
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return {
      ...args.result,
      rows: args.result.rows.map(transformRow)
    }
  }
}
