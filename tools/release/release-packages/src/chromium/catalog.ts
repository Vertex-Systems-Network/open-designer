import { releaseVersionSchema } from '#release/version'
import * as v from 'valibot'

import type { DesktopAsset } from '../native/catalog.ts'

/** The prerelease that holds the current Chromium build and its update feed. */
export const CHROMIUM_TAG = 'chromium'

export const chromiumVersionSchema = v.pipe(
  v.string(),
  v.regex(/^\d+\.\d+\.\d+-chromium\.[1-9]\d*$/)
)

/**
 * A Chromium build carries what master added since the last release, so it is a pre-release
 * of the next version: after 0.16.0 it builds as 0.17.0-chromium.N, and after 0.17.0-beta.2,
 * which already names the next version, as 0.17.0-chromium.N. N is the workflow run number,
 * so every build is newer than the last one to the updater.
 */
export function chromiumVersion(released: string, run: number): string {
  const [core = '', beta] = v.parse(releaseVersionSchema, released).split('-')
  const [major, minor] = core.split('.').map(Number)
  const next = beta ? core : `${major}.${(minor ?? 0) + 1}.0`
  return v.parse(chromiumVersionSchema, `${next}-chromium.${run}`)
}

export const chromiumBuilds = [
  { target: 'aarch64-apple-darwin', arch: 'aarch64', platform: 'darwin-aarch64' },
  { target: 'x86_64-apple-darwin', arch: 'x64', platform: 'darwin-x86_64' }
] as const

export const chromiumTargets = chromiumBuilds.map((build) => build.target)

export type ChromiumTarget = (typeof chromiumTargets)[number]

/** Bundles the Tauri CLI writes for OpenPencil Chromium, named apart per architecture. */
export function chromiumAssets(target: ChromiumTarget, version: string): DesktopAsset[] {
  v.parse(chromiumVersionSchema, version)
  const build = chromiumBuilds.find((entry) => entry.target === target)
  if (!build) throw new Error(`Not a Chromium target: ${target}`)

  return [
    {
      source: `OpenPencil Chromium_${version}_${build.arch}.dmg`,
      name: `OpenPencil-Chromium_${version}_${build.arch}.dmg`,
      updaterKeys: [],
      signed: false
    },
    {
      source: 'OpenPencil Chromium.app.tar.gz',
      name: `OpenPencil-Chromium_${build.arch}.app.tar.gz`,
      updaterKeys: [build.platform, `${build.platform}-app`],
      signed: true
    }
  ]
}
