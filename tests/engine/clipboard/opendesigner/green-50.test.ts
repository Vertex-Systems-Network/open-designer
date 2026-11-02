import { expect, test } from 'bun:test'

import { parseOpenDesignerClipboard } from '@open-designer/core/clipboard'
import { geometryBlobBounds } from '@open-designer/scene-graph/geometry'

const fixture = await Bun.file('tests/fixtures/clipboard/green-50.opendesigner.html').text()

test('preserved Green/50 clipboard geometry restores typed command buffers', () => {
  const parsed = parseOpenDesignerClipboard(fixture)
  const node = parsed?.nodes[0]
  expect(node?.name).toBe('Green/50')
  const path = node?.fillGeometry[0]
  expect(path?.commandsBlob).toBeInstanceOf(Uint8Array)
  expect(() => geometryBlobBounds(node?.fillGeometry ?? [])).not.toThrow()
})
