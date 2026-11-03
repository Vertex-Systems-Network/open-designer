const SESSION_STORAGE_PREFIX = 'open-designer:recovery-session:'

function recoveryStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function startedSessionIds(): string[] {
  const storage = recoveryStorage()
  if (!storage) return []
  try {
    const ids: string[] = []
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key?.startsWith(SESSION_STORAGE_PREFIX))
        ids.push(key.slice(SESSION_STORAGE_PREFIX.length))
    }
    return ids
  } catch {
    // Storage can be disabled or throw in privacy-restricted browser contexts.
    return []
  }
}

export function markSessionStarted(id: string): void {
  try {
    recoveryStorage()?.setItem(SESSION_STORAGE_PREFIX + id, '1')
  } catch (error) {
    console.warn('[Recovery] Could not mark session started:', error)
  }
}

export function forgetSession(id: string): void {
  try {
    recoveryStorage()?.removeItem(SESSION_STORAGE_PREFIX + id)
  } catch (error) {
    console.warn('[Recovery] Could not forget session:', error)
  }
}
