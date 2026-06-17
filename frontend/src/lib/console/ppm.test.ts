import { describe, expect, it } from 'vitest'

import { decodePpm, ppmToJpeg } from './ppm'

/** Build a minimal P6 PPM with the given header bytes and pixel payload. */
function makePpm(header: string, pixels: number[]): Buffer {
  return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(pixels)])
}

describe('decodePpm', () => {
  it('decodes a 2x1 P6 image into RGBA', () => {
    // red, green
    const buf = makePpm('P6\n2 1\n255\n', [255, 0, 0, 0, 255, 0])
    const out = decodePpm(buf)

    expect(out).not.toBeNull()
    expect(out!.width).toBe(2)
    expect(out!.height).toBe(1)
    expect(Array.from(out!.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  })

  it('handles width/height split across separate lines', () => {
    const buf = makePpm('P6\n1\n1\n255\n', [10, 20, 30])
    const out = decodePpm(buf)

    expect(out).not.toBeNull()
    expect(out!.width).toBe(1)
    expect(out!.height).toBe(1)
    expect(Array.from(out!.data)).toEqual([10, 20, 30, 255])
  })

  it('skips comment lines in the header', () => {
    const buf = makePpm('P6\n# created by qemu\n1 1\n255\n', [1, 2, 3])
    const out = decodePpm(buf)

    expect(out).not.toBeNull()
    expect(Array.from(out!.data)).toEqual([1, 2, 3, 255])
  })

  it('decodes 16-bit (maxval > 255) by taking the high byte of each channel', () => {
    // one pixel, big-endian 16-bit: R=0x0102, G=0x0304, B=0x0506 -> high bytes 1,3,5
    const buf = makePpm('P6\n1 1\n65535\n', [1, 2, 3, 4, 5, 6])
    const out = decodePpm(buf)

    expect(out).not.toBeNull()
    expect(Array.from(out!.data)).toEqual([1, 3, 5, 255])
  })

  it('returns null on a non-P6 magic', () => {
    expect(decodePpm(makePpm('P3\n1 1\n255\n', [0, 0, 0]))).toBeNull()
  })

  it('returns null when the pixel payload is truncated', () => {
    // header claims 2x2 (12 bytes) but only 3 are present
    expect(decodePpm(makePpm('P6\n2 2\n255\n', [1, 2, 3]))).toBeNull()
  })

  it('returns null on a malformed header (zero dimensions)', () => {
    expect(decodePpm(makePpm('P6\n0 0\n255\n', []))).toBeNull()
  })

  it('returns null on empty input', () => {
    expect(decodePpm(Buffer.alloc(0))).toBeNull()
  })
})

describe('ppmToJpeg', () => {
  it('encodes a valid PPM into a JPEG buffer (SOI marker)', () => {
    const buf = makePpm('P6\n2 1\n255\n', [255, 0, 0, 0, 255, 0])
    const jpeg = ppmToJpeg(buf)

    expect(jpeg).not.toBeNull()
    // JPEG files start with the Start-Of-Image marker 0xFFD8 and end with EOI 0xFFD9.
    expect(jpeg![0]).toBe(0xff)
    expect(jpeg![1]).toBe(0xd8)
    expect(jpeg!.length).toBeGreaterThan(2)
    // A real JPEG of a 2px image is far smaller than a hypothetical large raw frame.
    expect(jpeg!.length).toBeLessThan(buf.length + 1024)
  })

  it('returns null when the PPM cannot be decoded', () => {
    expect(ppmToJpeg(makePpm('P3\n1 1\n255\n', [0, 0, 0]))).toBeNull()
  })
})
