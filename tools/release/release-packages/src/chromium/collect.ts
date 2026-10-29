import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import * as v from 'valibot'

import { resolveReportedAssets } from '../native/artifacts.ts'
import { chromiumAssets, chromiumTargets, chromiumVersionSchema } from './catalog.ts'

const target = v.parse(v.picklist(chromiumTargets), process.env.CHROMIUM_TARGET)
const version = v.parse(chromiumVersionSchema, process.env.CHROMIUM_VERSION)
const reported = v.parse(
  v.pipe(v.string(), v.parseJson(), v.array(v.string())),
  process.env.TAURI_ARTIFACT_PATHS
)
const assets = await resolveReportedAssets(reported, chromiumAssets(target, version), process.cwd())

const output = join(process.cwd(), 'chromium-output')
await mkdir(output, { recursive: true })

for (const asset of assets) {
  await copyFile(asset.source, join(output, asset.name))
}

console.log(`Collected ${assets.length} files for ${target}`)
