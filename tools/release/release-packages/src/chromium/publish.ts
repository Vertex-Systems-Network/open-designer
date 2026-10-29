import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decode, toUint8Array } from 'js-base64'
import * as v from 'valibot'

import { ARTIFACT_TRANSFER_TIMEOUT_MS, releaseCommands } from '../native/commands.ts'
import { commitSchema } from '../native/context.ts'
import { assertSignedVersion } from '../native/signature.ts'
import { CHROMIUM_TAG, chromiumAssets, chromiumTargets, chromiumVersionSchema } from './catalog.ts'

const root = process.cwd()
const version = v.parse(chromiumVersionSchema, process.env.CHROMIUM_VERSION)
const source = v.parse(commitSchema, process.env.SOURCE_COMMIT)
const repository = v.parse(
  v.pipe(v.string(), v.regex(/^[\w.-]+\/[\w.-]+$/)),
  process.env.GITHUB_REPOSITORY
)
const { github, verifySignature } = releaseCommands(root)

const artifacts = join(root, 'chromium-artifacts')
const config = v.parse(
  v.pipe(
    v.string(),
    v.parseJson(),
    v.object({ plugins: v.object({ updater: v.object({ pubkey: v.string() }) }) })
  ),
  await readFile(join(root, 'desktop', 'tauri.conf.json'), 'utf8')
)

// Every architecture must be present and signed for this version before the old release goes.
const platforms: Record<string, { signature: string; url: string }> = {}
const temporary = await mkdtemp(join(tmpdir(), 'open-pencil-chromium-'))

try {
  const publicKey = join(temporary, 'key.pub')
  await writeFile(publicKey, toUint8Array(config.plugins.updater.pubkey))

  for (const target of chromiumTargets) {
    for (const asset of chromiumAssets(target, version)) {
      if (!asset.signed) continue

      const path = join(artifacts, asset.name)
      const signature = (await readFile(`${path}.sig`, 'utf8')).trim()
      const decoded = join(temporary, `${asset.name}.minisig`)
      await writeFile(decoded, toUint8Array(signature))
      await verifySignature(path, publicKey, decoded)
      assertSignedVersion(decode(signature), version, asset.name)

      for (const platform of asset.updaterKeys) {
        platforms[platform] = {
          signature,
          url: `https://github.com/${repository}/releases/download/${CHROMIUM_TAG}/${asset.name}`
        }
      }
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

await writeFile(
  join(artifacts, 'latest.json'),
  JSON.stringify({ version, pub_date: new Date().toISOString(), platforms }, null, 2)
)

const files = (await readdir(artifacts)).sort().map((name) => join(artifacts, name))
const existing = await github(['release', 'view', CHROMIUM_TAG, '--repo', repository]).then(
  () => true,
  () => false
)
if (existing) {
  await github(['release', 'delete', CHROMIUM_TAG, '--repo', repository, '--cleanup-tag', '--yes'])
}
await github(
  [
    'release',
    'create',
    CHROMIUM_TAG,
    ...files,
    '--repo',
    repository,
    '--target',
    source,
    '--prerelease',
    '--latest=false',
    '--title',
    `OpenPencil Chromium ${version}`,
    '--notes',
    `OpenPencil on Tauri v3 with the Chromium (CEF) runtime, built from ${source}. It installs beside OpenPencil and updates only from this release.`
  ],
  ARTIFACT_TRANSFER_TIMEOUT_MS
)

console.log(`Published OpenPencil Chromium ${version} with ${files.length} files`)
