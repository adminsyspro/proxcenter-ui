import jpeg from "jpeg-js"

/** A decoded PPM frame as packed RGBA bytes, ready for a JPEG encoder. */
export interface DecodedPpm {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, length === width * height * 4. */
  data: Buffer
}

const SPACE = 0x20
const TAB = 0x09
const LF = 0x0a
const CR = 0x0d
const HASH = 0x23 // '#'

function isWhitespace(byte: number): boolean {
  return byte === SPACE || byte === TAB || byte === LF || byte === CR
}

/**
 * Decode a binary PPM (P6) frame as produced by `qm monitor ... screendump`
 * into packed RGBA bytes.
 *
 * QEMU emits `P6\n<w> <h>\n<maxval>\n<binary RGB>` with maxval 255, but we parse
 * the format defensively: tokens may be split across lines, comment lines
 * (`# ...`) may appear anywhere in the header, and 16-bit channels (maxval > 255)
 * are downsampled to their high byte. Returns null on any malformed input rather
 * than throwing, so the caller can fall back to a JSON error response.
 */
export function decodePpm(buf: Buffer): DecodedPpm | null {
  let pos = 0

  const skipWhitespaceAndComments = (): void => {
    while (pos < buf.length) {
      const c = buf[pos]
      if (c === HASH) {
        // Comment runs to end of line.
        while (pos < buf.length && buf[pos] !== LF) pos++
      } else if (isWhitespace(c)) {
        pos++
      } else {
        break
      }
    }
  }

  const readToken = (): string => {
    skipWhitespaceAndComments()
    const start = pos
    while (pos < buf.length && !isWhitespace(buf[pos]) && buf[pos] !== HASH) pos++
    return buf.toString("ascii", start, pos)
  }

  if (readToken() !== "P6") return null

  const width = Number.parseInt(readToken(), 10)
  const height = Number.parseInt(readToken(), 10)
  const maxVal = Number.parseInt(readToken(), 10)
  if (!width || !height || !maxVal || width < 0 || height < 0) return null

  // Per spec, exactly one whitespace byte separates maxval from the pixel data.
  // readToken left `pos` on that separator; the payload begins one byte later.
  const dataStart = pos + 1
  const bytesPerChannel = maxVal > 255 ? 2 : 1
  const pixelBytes = bytesPerChannel * 3
  const pixelCount = width * height

  if (dataStart + pixelCount * pixelBytes > buf.length) return null

  const rgba = Buffer.allocUnsafe(pixelCount * 4)
  for (let i = 0; i < pixelCount; i++) {
    const src = dataStart + i * pixelBytes
    const dst = i * 4
    if (bytesPerChannel === 1) {
      rgba[dst] = buf[src]
      rgba[dst + 1] = buf[src + 1]
      rgba[dst + 2] = buf[src + 2]
    } else {
      // 16-bit big-endian: keep the high byte of each channel.
      rgba[dst] = buf[src]
      rgba[dst + 1] = buf[src + 2]
      rgba[dst + 2] = buf[src + 4]
    }
    rgba[dst + 3] = 255
  }

  return { width, height, data: rgba }
}

/**
 * Convert a binary PPM frame into a JPEG buffer. Returns null when the PPM is
 * malformed. `quality` is 0-100 (jpeg-js scale); 75 matches the quality the
 * browser previously used when it did this conversion client-side.
 */
export function ppmToJpeg(buf: Buffer, quality = 75): Buffer | null {
  const decoded = decodePpm(buf)
  if (!decoded) return null

  const { data } = jpeg.encode({ data: decoded.data, width: decoded.width, height: decoded.height }, quality)
  return Buffer.from(data)
}
