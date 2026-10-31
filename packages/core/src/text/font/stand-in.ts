import { fontTableView } from '#core/text/font/variation'

/** An open font drawn in place of a missing proprietary face, measured to its line box. */
export interface FontStandIn {
  family: string
  file: string
  scale: number
  ascent: number
  descent: number
}

/** Figma Hand is licensed for Figma; Caveat is the closest licensed handwriting substitute. */
export const FONT_STAND_INS: Readonly<Record<string, FontStandIn>> = {
  'Figma Hand': { family: 'Caveat', file: '/CaveatVariable.woff2', scale: 1.69, ascent: 1.02, descent: 0.36 }
}

export function fontStandIn(family: string): FontStandIn | null {
  return Object.hasOwn(FONT_STAND_INS, family) ? FONT_STAND_INS[family] : null
}

/** Adapt font metrics while leaving glyph outlines untouched. */
export function standInFont(font: ArrayBuffer, standIn: FontStandIn): ArrayBuffer | null {
  const data = font.slice(0)
  const head = fontTableView(data, 'head')
  const hhea = fontTableView(data, 'hhea')
  if (!head || !hhea) return null
  const unitsPerEm = Math.round(head.getUint16(18) / standIn.scale)
  const ascent = Math.round(standIn.ascent * unitsPerEm)
  const descent = Math.round(standIn.descent * unitsPerEm)
  head.setUint16(18, unitsPerEm)
  hhea.setInt16(4, ascent)
  hhea.setInt16(6, -descent)
  hhea.setInt16(8, 0)
  const os2 = fontTableView(data, 'OS/2')
  if (os2 && os2.byteLength >= 78) {
    os2.setInt16(68, ascent)
    os2.setInt16(70, -descent)
    os2.setInt16(72, 0)
    os2.setUint16(74, ascent)
    os2.setUint16(76, descent)
  }
  return data
}
