import fsd from '@feature-sliced/steiger-plugin'
import { defineConfig } from 'steiger'

import { openPencilArchitecturePlugin } from './tools/checks/architecture/src/steiger-rules/index.ts'

// OpenDesigner is not laid out as canonical Feature-Sliced Design layers.
// Keep Steiger focused on project-specific architecture boundaries instead of
// enabling fsd.configs.recommended, which treats src/ and packages/ as FSD layer typos.
export default defineConfig([
  fsd.plugin,
  openPencilArchitecturePlugin,
  {
    ignores: [
      '.claude/**',
      'node_modules/**',
      'dist/**',
      'desktop/**',
      'public/**',
      'scratch/**',
      'demo-recordings/**'
    ]
  },
  {
    rules: {
      'open-designer/prefer-domain-folders-over-filename-prefixes': 'error',
      'open-designer/strict-test-file-placement': 'error',
      'open-designer/no-engine-only-assertions-in-e2e': 'error',
      'open-designer/no-e2e-imports-in-engine-tests': 'error',
      'open-designer/no-root-markdown-clutter': 'error',
      'open-designer/no-prototype-or-generated-imports': 'error',
      'open-designer/no-property-panel-imports-in-canvas': 'error',
      'open-designer/no-app-imports-in-workspace-packages': 'error',
      'open-designer/no-package-internals-in-app': 'error',
      'open-designer/no-foreign-package-local-aliases': 'error',
      'open-designer/no-app-imports-components-or-views': 'error',
      'open-designer/no-components-import-views': 'error',
      'open-designer/no-views-imported-outside-entry': 'error',
      'open-designer/no-editor-imports-in-cloud-portal': 'error',
      'open-designer/no-tailwind-variants-in-themes': 'error',
      'open-designer/no-non-ui-imports-in-shared-ui': 'error',
      'open-designer/no-app-imports-in-shared-ui': 'error',
      'open-designer/no-property-panel-internals-outside-panel': 'error',
      'open-designer/no-production-test-ids-in-shared-layers': 'error',
      'open-designer/no-native-title-attributes-in-vue': 'error',
      'open-designer/no-ui-imports-in-core': 'error',
      'open-designer/no-graph-builders-in-front-ends': 'error',
      'open-designer/scripts-are-entrypoint-shims': 'error',
      'open-designer/strict-tools-layout': 'error',
      'open-designer/unique-component-names': 'error',
      'open-designer/multi-word-component-names': 'error'
    }
  }
])
