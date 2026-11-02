import { describe, expect, test } from 'bun:test'

import { graphBuilderImports } from '../src/steiger-rules/graph-builders'

describe('graph builders in front ends', () => {
  test('finds format packages building layers that Core would lay out', () => {
    const content = [
      "import { browserHTMLToSceneGraph, serializeHTML } from '@open-designer/dom-css/browser'",
      "import { parsePenFile as parse } from '@open-designer/pen'",
      "import { renderTree } from '@open-designer/design-jsx'"
    ].join('\n')
    expect(graphBuilderImports('src/app/document/io/dom.ts', content)).toEqual([
      { specifier: '@open-designer/dom-css/browser', name: 'browserHTMLToSceneGraph', line: 1 },
      { specifier: '@open-designer/pen', name: 'parsePenFile', line: 2 },
      { specifier: '@open-designer/design-jsx', name: 'renderTree', line: 3 }
    ])
  })

  test('reports the line in a Vue file', () => {
    const content = `<template>\n  <div />\n</template>\n<script setup lang="ts">\nimport { htmlToSceneGraph } from '@open-designer/dom-css'\n</script>\n`
    expect(graphBuilderImports('packages/vue/src/Panel.vue', content)).toEqual([
      { specifier: '@open-designer/dom-css', name: 'htmlToSceneGraph', line: 5 }
    ])
  })

  test('allows Core, styling helpers, types, and the format packages themselves', () => {
    expect(
      graphBuilderImports(
        'src/app/code/dom-preview.ts',
        [
          "import { sceneGraphFromStyledHTML } from '@open-designer/core/io/formats/html/layers'",
          "import { browserHTMLToDesignDocument } from '@open-designer/dom-css/browser'",
          "import { renderTree } from '@open-designer/core/design-jsx'",
          "import { type renderJSX } from '@open-designer/design-jsx'"
        ].join('\n')
      )
    ).toEqual([])
    expect(
      graphBuilderImports(
        'packages/core/src/io/formats/html/import.ts',
        "import { designDocumentToSceneGraph } from '@open-designer/dom-css'"
      )
    ).toEqual([])
  })
})
