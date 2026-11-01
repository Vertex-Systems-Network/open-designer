---
title: Erste Schritte mit dem SDK
description: Binden Sie @open-designer/vue ein, erstellen Sie einen Editor und richten Sie die Arbeitsfläche ein.
---

# Erste Schritte mit dem SDK

## Installation

```bash
bun add @open-designer/core @open-designer/vue canvaskit-wasm
```

Das SDK befindet sich im OpenDesigner-Monorepo und wird als Paket `@open-designer/vue` veröffentlicht.

```ts
import { createEditor } from '@open-designer/core'
import { provideEditor } from '@open-designer/vue'
import { useCanvas } from '@open-designer/vue/canvas/surface'
```

## Anwendungsebenen

Eine Anwendung auf Grundlage des SDK besteht aus drei Ebenen:

1. `@open-designer/core` — die vom Framework unabhängige Editor-Engine;
2. `@open-designer/vue` — Composables und Komponenten ohne vorgegebenes Erscheinungsbild für Vue;
3. die Anwendung — Gestaltung, Routing, Dateiverwaltung und produktspezifische Oberfläche.

## Minimale Einrichtung

### 1. Editor erstellen

```ts
import { createEditor } from '@open-designer/core'

const editor = createEditor({
  width: 1200,
  height: 800,
})
```

### 2. Editor für untergeordnete Komponenten bereitstellen

```vue
<script setup lang="ts">
import { provideEditor } from '@open-designer/vue'

import type { Editor } from '@open-designer/core'

const props = defineProps<{
  editor: Editor
}>()

provideEditor(props.editor)
</script>

<template>
  <slot />
</template>
```

`provideEditor()` stellt die Editor-Instanz allen darunterliegenden Komponenten zur Verfügung. Die Dokumentation ruft diese Funktion direkt auf, da sie zur aktuellen öffentlichen API gehört.

### 3. Arbeitsfläche anbinden

```vue
<script setup lang="ts">
import { ref } from 'vue'

import { useCanvas } from '@open-designer/vue/canvas/surface'
import { useEditor } from '@open-designer/vue'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const editor = useEditor()

useCanvas(canvasRef, editor)
</script>

<template>
  <canvas ref="canvasRef" class="size-full" />
</template>
```

## Composables verwenden

Nach dem Aufruf von `provideEditor()` können untergeordnete Komponenten die Auswahl auslesen und Editor-Befehle ausführen:

```ts
import { useEditorCommands } from '@open-designer/vue/editor/commands'
import { useSelectionState } from '@open-designer/vue/editor/selection-state'

const selection = useSelectionState()
const commands = useEditorCommands()
```

## Einfaches Beispiel

```vue
<script setup lang="ts">
import { ref } from 'vue'

import { useCanvas } from '@open-designer/vue/canvas/surface'
import { useEditor } from '@open-designer/vue'
import { useSelectionState } from '@open-designer/vue/editor/selection-state'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const editor = useEditor()
const { selectedCount } = useSelectionState()

useCanvas(canvasRef, editor, {
  onReady: () => {
    console.log('Canvas ready')
  },
})
</script>

<template>
  <div class="grid h-full grid-rows-[1fr_auto]">
    <canvas ref="canvasRef" class="size-full" />
    <div class="border-t px-3 py-2 text-xs text-muted">
      Ausgewählt: {{ selectedCount }}
    </div>
  </div>
</template>
```

## Nächste Schritte

- [Architektur](./architecture)
- [API-Referenz](./api/)
- [useEditor](./api/composables/use-editor)
- [useCanvas](./api/composables/use-canvas)
- [useI18n](./api/composables/use-i18n)
