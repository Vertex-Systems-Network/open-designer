/** Stable names for the app's independent IndexedDB databases. */
export const APP_DATABASE_NAMES = {
  chats: 'open-designer-chats',
  credentials: 'open-designer-credentials',
  libraries: 'open-designer-libraries',
  localCanvas: 'open-designer-cloud-local',
  outbox: 'open-designer-cloud-outbox',
  recovery: 'open-designer-recovery',
  diagnostics: 'open-designer-diagnostics',
  skills: 'open-designer-skills',
  /** Written and deleted once per page, to learn whether the engine stores Blobs. */
  blobProbe: 'open-designer-blob-probe'
} as const
