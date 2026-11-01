---
title: provideEditor
description: Udostępnianie instancji edytora OpenDesigner komponentom potomnym przez dependency injection.
---

# provideEditor

`provideEditor(editor)` udostępnia edytor OpenDesigner funkcjom composable i komponentom bez narzuconych stylów znajdującym się niżej w drzewie Vue.

Na tej funkcji opiera się `useEditor()`.

## Użycie

```ts
import { provideEditor } from '@open-designer/vue'

provideEditor(editor)
```

## Przykład

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

## Uwagi

Aktualne SDK używa bezpośrednio `provideEditor()` i `useEditor()`. Niektóre starsze przykłady i komunikaty błędów wspominają komponent `OpenDesignerProvider`, ale nie należy on do obecnego publicznego API.

## Zobacz też

- [useEditor](./use-editor)
