import * as v from 'valibot'

import type { FigmaNodeProxy } from '#core/figma-api'
import { textFonts } from '#core/tools/modify/text'
import { defineTool } from '#core/tools/schema'

const batchOpsSchema = v.array(
  v.object({ id: v.string(), props: v.record(v.string(), v.unknown()) })
)
type BatchOp = v.InferOutput<typeof batchOpsSchema>[number]

const BATCH_PROPERTY_FIELDS = [
  'itemSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'counterAxisAlignItems',
  'primaryAxisAlignItems',
  'layoutSizingHorizontal',
  'layoutSizingVertical',
  'layoutGrow',
  'name',
  'visible',
  'cornerRadius',
  'opacity',
  'textAutoResize',
  'layoutMode'
] as const

/** The operations a call names, or why they cannot be read. */
function parseOperations(operations: string): BatchOp[] | { error: string } {
  const json = v.safeParse(v.pipe(v.string(), v.parseJson()), operations)
  if (!json.success) return { error: 'Invalid JSON in operations' }
  const ops = v.safeParse(batchOpsSchema, json.output)
  if (!ops.success) return { error: 'operations must be a JSON array of {id, props}' }
  return ops.output
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function applyBatchProps(node: FigmaNodeProxy, props: Record<string, unknown>): string[] {
  const updated: string[] = []

  if (props.spacing !== undefined) {
    node.itemSpacing = num(props.spacing)
    updated.push('spacing')
  }
  if (props.padding !== undefined) {
    const value = num(props.padding)
    node.paddingTop = value
    node.paddingRight = value
    node.paddingBottom = value
    node.paddingLeft = value
    updated.push('padding')
  }
  if (props.padding_horizontal !== undefined) {
    node.paddingLeft = num(props.padding_horizontal)
    node.paddingRight = num(props.padding_horizontal)
    updated.push('padding_horizontal')
  }
  if (props.padding_vertical !== undefined) {
    node.paddingTop = num(props.padding_vertical)
    node.paddingBottom = num(props.padding_vertical)
    updated.push('padding_vertical')
  }
  if (props.counter_align !== undefined) {
    node.counterAxisAlignItems = str(props.counter_align)
    updated.push('counter_align')
  }
  if (props.align !== undefined) {
    node.primaryAxisAlignItems = str(props.align)
    updated.push('align')
  }
  if (props.sizing_horizontal !== undefined) {
    node.layoutSizingHorizontal = str(props.sizing_horizontal)
    updated.push('sizing_horizontal')
  }
  if (props.sizing_vertical !== undefined) {
    node.layoutSizingVertical = str(props.sizing_vertical)
    updated.push('sizing_vertical')
  }
  if (props.grow !== undefined) {
    node.layoutGrow = num(props.grow)
    updated.push('grow')
  }
  if (props.name !== undefined) {
    node.name = str(props.name)
    updated.push('name')
  }
  if (props.visible !== undefined) {
    node.visible = Boolean(props.visible)
    updated.push('visible')
  }
  if (props.corner_radius !== undefined) {
    node.cornerRadius = num(props.corner_radius)
    updated.push('corner_radius')
  }
  if (props.opacity !== undefined) {
    node.opacity = num(props.opacity)
    updated.push('opacity')
  }
  if (props.auto_resize !== undefined) {
    node.textAutoResize = str(props.auto_resize)
    updated.push('auto_resize')
  }
  if (props.direction !== undefined) {
    node.layoutMode = str(props.direction) as 'HORIZONTAL' | 'VERTICAL'
    updated.push('direction')
  }

  return updated
}

export const batchUpdate = defineTool({
  name: 'batch_update',

  description:
    'Execute multiple modifications in one call. Each operation is {id, props} where props can include: spacing, padding, padding_horizontal, padding_vertical, counter_align, sizing_horizontal, sizing_vertical, grow, name, visible, corner_radius, auto_resize (for text), direction. Runs all updates with one layout recompute.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    operations: v.pipe(
      v.string(),
      v.description(
        'JSON array: [{"id":"0:5","props":{"spacing":8}},{"id":"0:6","props":{"sizing_horizontal":"FILL","grow":1}}]'
      )
    )
  }),
  // Text that resizes itself lays out again, so its fonts load first.
  fonts: (figma, { operations }) => {
    const ops = parseOperations(operations)
    if (!Array.isArray(ops)) return []
    return ops.flatMap((op) => (op.props.auto_resize === undefined ? [] : textFonts(figma, op.id)))
  },
  execute: (figma, { operations }) => {
    const ops = parseOperations(operations)
    if (!Array.isArray(ops)) return ops

    // Resolve every target before changing anything, so a missing ID cannot leave a partial batch.
    const targets = ops.map((op) => {
      const node = figma.getNodeById(op.id)
      if (!node) throw new Error(`Node "${op.id}" not found`)
      return { op, node }
    })

    const previous = targets.map(({ node }) => ({
      node,
      properties: Object.fromEntries(
        BATCH_PROPERTY_FIELDS.map((field) => [field, Reflect.get(node, field)])
      )
    }))
    const results: Array<{ id: string; updated: string[] }> = []

    try {
      for (const { op, node } of targets) {
        const updated = applyBatchProps(node, op.props)
        if (updated.length > 0) results.push({ id: op.id, updated })
      }
    } catch (error) {
      // Restore every writable target if any property setter rejects the batch.
      for (const { node, properties } of previous.toReversed()) {
        for (const [field, value] of Object.entries(properties)) {
          try {
            Reflect.set(node, field, value)
          } catch {
            // Read-only targets reject the original write too; they have nothing to restore.
          }
        }
      }
      throw error
    }

    const out: Record<string, unknown> = { updated: results.length }
    if (results.length > 0) out.results = results
    return out
  }
})
