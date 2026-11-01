# @open-designer/core

Editor engine for [OpenDesigner](https://openpencil.dev): the CanvasKit (Skia WASM) renderer, Yoga layout, the framework-agnostic editor with undo and selection, the Figma Plugin API compatibility layer, the AI/MCP tool definitions, clipboard and vector conversion, and format-neutral document I/O.

It depends on `@open-designer/scene-graph`, `@open-designer/pen`, `@open-designer/kiwi`, and `@open-designer/fig`, and keeps browser DOM out so it runs in the app, the CLI, the MCP server, and headless scripts alike.

The root entry is the editor: `createEditor` and its types. Everything else comes from the subpaths listed in `package.json` `exports`, for example `@open-designer/core/io`, `@open-designer/core/geometry`, and `@open-designer/core/canvaskit`, and each name has exactly one of them.

Scripts get two globals through `compileScript` from `@open-designer/core/tools`: `figma`, the Figma Plugin API over a document, and `opendesigner` (`OpenDesignerAPI` from `@open-designer/core/opendesigner-api`), what OpenDesigner adds to it in the same style, such as making a component behave as a Reka UI control:

```ts
import { FigmaAPI } from '@open-designer/core/figma-api'
import { compileScript } from '@open-designer/core/tools'

await compileScript(`
  const set = figma.currentPage.findOne((n) => n.name === 'Switch')
  opendesigner.setBehaviour(set, { kind: 'switch', values: { value: 'State' } })
`)(new FigmaAPI(graph))
```

- Programmable overview and SDK docs: https://openpencil.dev/programmable/
- Source and issues: https://github.com/open-pencil/open-pencil

MIT License.
