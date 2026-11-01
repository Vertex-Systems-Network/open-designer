import { shallowReadonly, shallowRef } from 'vue'

import type { RecoverySnapshotMeta } from '@/app/document/recovery'
import { recoveryEnabled } from '@/app/document/recovery/preferences'
import {
  forgetCrashedSessions,
  recoverySessionStates,
  type RecoverySessionStates
} from '@/app/document/recovery/session'
import {
  discardRecoverySnapshot,
  listRecoverySnapshots,
  openRecoveryIds,
  restoreRecoverySnapshot
} from '@/app/tabs'

export interface RecoverableSnapshot extends RecoverySnapshotMeta {
  /** Its session crashed, rather than closing or reloading its window with the copy kept. */
  crashed: boolean
}

/**
 * The copies left to recover: none a running session writes or a tab has open. A copy written
 * before copies named their session belongs to none, so it is left to recover and not a crash.
 */
export function recoverableSnapshots(
  snapshots: readonly RecoverySnapshotMeta[],
  sessions: RecoverySessionStates,
  open: ReadonlySet<string>
): RecoverableSnapshot[] {
  return snapshots
    .filter(
      (snapshot) =>
        (!snapshot.sessionId || !sessions.live.has(snapshot.sessionId)) && !open.has(snapshot.id)
    )
    .map((snapshot) => ({
      ...snapshot,
      crashed: Boolean(snapshot.sessionId && sessions.crashed.has(snapshot.sessionId))
    }))
}

const listed = shallowRef<readonly RecoverableSnapshot[]>([])
let refreshGeneration = 0

/** The copies Home lists, as of the last successful refresh. */
export const recoverable = shallowReadonly(listed)

export function matchingRecoverableSnapshots(query: string, locale: string) {
  if (!recoveryEnabled.value) return []
  return listed.value.filter((snapshot) =>
    snapshot.documentName.toLocaleLowerCase(locale).includes(query)
  )
}

/**
 * Lists the copies left to recover. reportCrash reports the crashed sessions found, so later
 * lists mark their copies as kept ones and the next start does not ask about them again.
 */
export async function refreshRecoverableSnapshots({
  reportCrash = false
}: { reportCrash?: boolean } = {}): Promise<readonly RecoverableSnapshot[]> {
  const generation = ++refreshGeneration
  if (!recoveryEnabled.value) {
    listed.value = []
    return listed.value
  }
  const [snapshots, sessions] = await Promise.all([
    listRecoverySnapshots(),
    recoverySessionStates()
  ])
  if (generation !== refreshGeneration || !recoveryEnabled.value) return listed.value

  const found = recoverableSnapshots(snapshots, sessions, openRecoveryIds())
  if (reportCrash) forgetCrashedSessions(sessions.crashed)
  listed.value = found
  return found
}

function drop(id: string): void {
  refreshGeneration++
  listed.value = listed.value.filter((snapshot) => snapshot.id !== id)
}

export async function restoreRecoverable(id: string): Promise<void> {
  await restoreRecoverySnapshot(id)
  drop(id)
}

export async function discardRecoverable(id: string): Promise<void> {
  await discardRecoverySnapshot(id)
  drop(id)
}
