import { writeReferences } from '#authoring-reference/artifacts'

import { resolveWorkspaceRoot } from '@open-designer/package-artifacts-tools'

await writeReferences(await resolveWorkspaceRoot(process.cwd()))
