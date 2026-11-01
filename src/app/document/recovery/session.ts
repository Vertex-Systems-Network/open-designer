import { createCanvasId } from '@/app/storage/id'

/** This window's app session; the recovery copies it writes carry this id. */
export const recoverySessionId = createCanvasId()

const SESSION_LOCK_PREFIX = 'open-designer:recovery-session:'
const SESSION_STORAGE_PREFIX = 'open-designer:recovery-session:'

type SessionLocks = Pick<LockManager, 'query' | 'request'>

function sessionLocks(): SessionLocks | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.locks
}

function sessionStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function startedSessionIds(): string[] {
  const storage = sessionStorage()
  if (!storage) return []
  const ids: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(SESSION_STORAGE_PREFIX)) ids.push(key.slice(SESSION_STORAGE_PREFIX.length))
  }
  return ids
}

function markSessionStarted(id: string): void {
  sessionStorage()?.setItem(SESSION_STORAGE_PREFIX + id, '1')
}

function forgetSession(id: string): void {
  sessionStorage()?.removeItem(SESSION_STORAGE_PREFIX + id)
}

/** Ends the hold on this session's lock; the lock also goes when the window does, however it goes. */
let releaseSessionLock: (() => void) | null = null
let requestPending = false
let sessionActive = false
let sessionGeneration = 0

/** Marks this session running only after its Web Lock has been acquired. */
export function startRecoverySession(locks = sessionLocks()): void {
  sessionActive = true
  if (!locks || releaseSessionLock || requestPending) return

  const generation = ++sessionGeneration
  requestPending = true
  void locks
    .request(SESSION_LOCK_PREFIX + recoverySessionId, () => {
      if (!sessionActive || generation !== sessionGeneration) return
      markSessionStarted(recoverySessionId)
      return new Promise<void>((resolve) => {
        releaseSessionLock = resolve
      })
    })
    .catch((error: unknown) => {
      console.warn('[Recovery] Failed to hold the session lock:', error)
    })
    .finally(() => {
      if (generation === sessionGeneration) requestPending = false
    })
}

/** The window closed or reloaded on purpose, so the copies it leaves were kept, not lost to a crash. */
export function endRecoverySession(): void {
  sessionActive = false
  sessionGeneration++
  requestPending = false
  forgetSession(recoverySessionId)
  releaseSessionLock?.()
  releaseSessionLock = null
}

export interface RecoverySessionStates {
  /** Sessions still running in some window, this one included; their copies are theirs. */
  live: ReadonlySet<string>
  /** Sessions that ended without closing their window. */
  crashed: ReadonlySet<string>
}

/**
 * Which sessions are running and which crashed, from the sessions started and the ones whose
 * locks are held. Without Web Locks only this window is known to be live; other copies remain
 * recoverable on Home without a crash prompt.
 */
export function sessionStates(
  started: readonly string[],
  held: readonly string[] | null
): RecoverySessionStates {
  if (!held) return { live: new Set([recoverySessionId]), crashed: new Set() }
  const live = new Set([recoverySessionId, ...held])
  return { live, crashed: new Set(started.filter((id) => !live.has(id))) }
}

export async function recoverySessionStates(
  locks = sessionLocks()
): Promise<RecoverySessionStates> {
  if (!locks) return sessionStates([], null)
  const { held = [] } = await locks.query()
  const sessions = held.flatMap(({ name }) =>
    name?.startsWith(SESSION_LOCK_PREFIX) ? [name.slice(SESSION_LOCK_PREFIX.length)] : []
  )
  return sessionStates(startedSessionIds(), sessions)
}

/** A crash is reported once: its copies stay on Home, but the next start does not ask again. */
export function forgetCrashedSessions(crashed: ReadonlySet<string>): void {
  for (const id of crashed) forgetSession(id)
}
