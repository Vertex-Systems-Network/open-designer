---
title: Начало работы с SDK
description: Подключение @open-designer/vue, создание редактора и настройка холста.
---

# Начало работы с SDK

## Установка

```bash
bun add @open-designer/core @open-designer/vue canvaskit-wasm
```

SDK находится в монорепозитории OpenDesigner и опубликован как пакет `@open-designer/vue`.

```ts
import { createEditor } from '@open-designer/core'
import { provideEditor } from '@open-designer/vue'
import { useCanvas } from '@open-designer/vue/canvas/surface'
```

## Из чего состоит приложение

В приложении на базе SDK можно выделить три уровня:

1. `@open-designer/core` — движок редактора, не зависящий от конкретного framework;
2. `@open-designer/vue` — компонуемые функции и компоненты без предустановленных стилей для Vue;
3. ваше приложение — оформление, маршрутизация, работа с файлами и интерфейс продукта.

## Минимальная настройка

### 1. Создайте редактор

```ts
import { createEditor } from '@open-designer/core'

const editor = createEditor({
  width: 1200,
  height: 800,
})
```

### 2. Передайте редактор дочерним компонентам Vue

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

`provideEditor()` делает экземпляр редактора доступным во всём расположенном ниже дереве компонентов. В документации используется прямой вызов этой функции, поскольку именно он входит в актуальный публичный API.

### 3. Подключите холст

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

## Использование composables

После вызова `provideEditor()` дочерние компоненты могут получать сведения о выделении и выполнять команды редактора:

```ts
import { useEditorCommands } from '@open-designer/vue/editor/commands'
import { useSelectionState } from '@open-designer/vue/editor/selection-state'

const selection = useSelectionState()
const commands = useEditorCommands()
```

## Простой пример

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
      Selected: {{ selectedCount }}
    </div>
  </div>
</template>
```

## Что читать дальше

- [Архитектура](./architecture)
- [Справочник API](./api/)
- [useEditor](./api/composables/use-editor)
- [useCanvas](./api/composables/use-canvas)
- [useI18n](./api/composables/use-i18n)
