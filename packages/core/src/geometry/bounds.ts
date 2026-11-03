export interface AxisAlignedBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Returns the smallest axis-aligned box that contains every input box. */
export function unionBounds(bounds: readonly AxisAlignedBounds[]): AxisAlignedBounds | null {
  if (bounds.length === 0) return null
  const first = bounds[0]!
  let minX = first.x
  let minY = first.y
  let maxX = first.x + first.width
  let maxY = first.y + first.height
  for (const box of bounds.slice(1)) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
