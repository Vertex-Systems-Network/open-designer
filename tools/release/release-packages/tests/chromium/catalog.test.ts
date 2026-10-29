import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromiumAssets, chromiumVersion } from '#release/chromium/catalog'
import { resolveReportedAssets } from '#release/native/artifacts'

test('builds a pre-release of the version after the last release', () => {
  expect(chromiumVersion('0.16.0', 7)).toBe('0.17.0-chromium.7')
  expect(chromiumVersion('1.9.3', 1)).toBe('1.10.0-chromium.1')
})

test('keeps the version a beta already names', () => {
  expect(chromiumVersion('0.17.0-beta.2', 7)).toBe('0.17.0-chromium.7')
})

test('rejects versions that are not releases', () => {
  expect(() => chromiumVersion('0.16.0-chromium.3', 7)).toThrow()
  expect(() => chromiumVersion('0.16.0', 0)).toThrow()
})

test('names both architectures apart and feeds each to its updater platform', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chromium-artifacts-'))

  try {
    const version = '0.17.0-chromium.7'
    const reported = await Promise.all(
      [
        'OpenPencil Chromium_0.17.0-chromium.7_x64.dmg',
        'OpenPencil Chromium.app.tar.gz',
        'OpenPencil Chromium.app.tar.gz.sig'
      ].map(async (name) => {
        await writeFile(join(root, name), 'fixture')
        return join(root, name)
      })
    )
    const expected = chromiumAssets('x86_64-apple-darwin', version)
    const assets = await resolveReportedAssets(reported, expected, root)

    expect(assets.map((asset) => asset.name).sort()).toEqual([
      'OpenPencil-Chromium_0.17.0-chromium.7_x64.dmg',
      'OpenPencil-Chromium_x64.app.tar.gz',
      'OpenPencil-Chromium_x64.app.tar.gz.sig'
    ])
    expect(expected.flatMap((asset) => asset.updaterKeys)).toEqual([
      'darwin-x86_64',
      'darwin-x86_64-app'
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
