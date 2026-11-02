import { APP_VERSION } from '@/app/runtime/version'

/** The Harness companion runs Pi; it is installed separately and must match the app version. */
export const HARNESS_EXECUTABLE = 'opendesigner-harness'
export const HARNESS_PACKAGE = '@open-designer/harness'
export const HARNESS_INSTALL_TARGET = `${HARNESS_PACKAGE}@${APP_VERSION}`
