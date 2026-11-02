import type { GUID } from '@open-designer/kiwi/fig'

export function guid(localID: number, sessionID = 1): GUID {
  return { sessionID, localID }
}
