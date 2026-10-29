import { appendFile, readFile } from 'node:fs/promises'

import * as v from 'valibot'

import { releaseCommands } from '../native/commands.ts'
import { commitSchema } from '../native/context.ts'
import { chromiumBuilds, chromiumVersion } from './catalog.ts'

const run = v.parse(
  v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1)),
  process.env.GITHUB_RUN_NUMBER
)
const config = v.parse(
  v.pipe(v.string(), v.parseJson(), v.object({ version: v.string() })),
  await readFile('desktop/tauri.conf.json', 'utf8')
)
const version = chromiumVersion(config.version, run)
const source = v.parse(commitSchema, await releaseCommands(process.cwd()).git('rev-parse', 'HEAD'))

const output = process.env.GITHUB_OUTPUT
if (!output) throw new Error('Missing GITHUB_OUTPUT')

await appendFile(
  output,
  [
    `version=${version}`,
    `source=${source}`,
    `matrix=${JSON.stringify({ include: chromiumBuilds })}`,
    ''
  ].join('\n')
)

console.log(`OpenPencil Chromium ${version} from ${source}`)
