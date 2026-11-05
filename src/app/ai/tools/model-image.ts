import { fromUint8Array, toUint8Array } from 'js-base64'

import { getCanvasKit } from '@open-designer/core/canvaskit'
import { reencodeImage } from '@open-designer/core/io/formats/raster'
import type { ModelImage } from '@open-designer/core/tools'

const WEBP_QUALITY = 90

/** Keep PNG when it is smaller or encoding is unavailable; the stored tool result is unchanged. */
export async function encodeWebPModelImage(image: ModelImage): Promise<ModelImage> {
  if (image.mediaType !== 'image/png') return image
  const png = toUint8Array(image.data)
  const webp = reencodeImage(await getCanvasKit(), png, 'WEBP', WEBP_QUALITY)
  return webp && webp.length < png.length
    ? { data: fromUint8Array(webp), mediaType: 'image/webp' }
    : image
}
