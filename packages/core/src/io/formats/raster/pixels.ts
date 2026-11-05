import type { CanvasKit } from 'canvaskit-wasm'

import type { RasterExportFormat } from './render'

/** Unpremultiplied sRGB RGBA pixels, row-major with no padding. */
export interface RGBAImage {
  width: number
  height: number
  data: Uint8Array
}

/** Decode and encode raster images for pixel-level tools; backed by CanvasKit in app and CLI. */
export interface RasterCodec {
  decode(bytes: Uint8Array): RGBAImage | null
  encodePNG(image: RGBAImage): Uint8Array | null
}

export function createCanvasKitRasterCodec(ck: CanvasKit): RasterCodec {
  const info = (width: number, height: number) => ({
    alphaType: ck.AlphaType.Unpremul,
    colorType: ck.ColorType.RGBA_8888,
    colorSpace: ck.ColorSpace.SRGB,
    width,
    height
  })

  return {
    decode(bytes) {
      const image = ck.MakeImageFromEncoded(bytes)
      if (!image) return null
      try {
        const width = image.width()
        const height = image.height()
        const pixels = image.readPixels(0, 0, info(width, height))
        // RGBA_8888 always reads back as bytes.
        if (!(pixels instanceof Uint8Array)) return null
        return { width, height, data: pixels }
      } finally {
        image.delete()
      }
    },
    encodePNG({ width, height, data }) {
      const image = ck.MakeImage(info(width, height), data, width * 4)
      if (!image) return null
      try {
        const encoded = image.encodeToBytes(ck.ImageFormat.PNG, 100)
        return encoded ? new Uint8Array(encoded) : null
      } finally {
        image.delete()
      }
    }
  }
}

/** Encodes an existing image as JPEG or WebP; null when the CanvasKit build cannot encode it. */
export function reencodeImage(
  ck: CanvasKit,
  bytes: Uint8Array,
  format: RasterExportFormat,
  quality: number
): Uint8Array | null {
  const image = ck.MakeImageFromEncoded(bytes)
  if (!image) return null
  try {
    let imageFormat: CanvasKit['ImageFormat'][keyof CanvasKit['ImageFormat']]
    switch (format) {
      case 'JPG':
        imageFormat = ck.ImageFormat.JPEG
        break
      case 'WEBP':
        imageFormat = ck.ImageFormat.WEBP
        break
      default:
        imageFormat = ck.ImageFormat.PNG
    }
    const encoded = image.encodeToBytes(imageFormat, quality)
    return encoded ? new Uint8Array(encoded) : null
  } finally {
    image.delete()
  }
}
