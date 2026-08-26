import { describe, expect, it } from "vitest"

import { CBT_BLOCK_SIZE, cbtBitmapToExtents } from "./cbt-bitmap"

describe("xcpng/cbt-bitmap", () => {
  it("returns no extents for an empty bitmap", () => {
    expect(cbtBitmapToExtents("", CBT_BLOCK_SIZE)).toEqual([])
  })

  it("decodes the most significant bit as the first block", () => {
    const bitmap = Buffer.from([0x80]).toString("base64")

    expect(cbtBitmapToExtents(bitmap, 8 * CBT_BLOCK_SIZE)).toEqual([
      { offset: 0, length: CBT_BLOCK_SIZE },
    ])
  })

  it("decodes the least significant bit as the eighth block", () => {
    const bitmap = Buffer.from([0x01]).toString("base64")

    expect(cbtBitmapToExtents(bitmap, 8 * CBT_BLOCK_SIZE)).toEqual([
      { offset: 7 * CBT_BLOCK_SIZE, length: CBT_BLOCK_SIZE },
    ])
  })

  it("merges consecutive blocks across byte boundaries", () => {
    const bitmap = Buffer.from([0xff, 0x80]).toString("base64")

    expect(cbtBitmapToExtents(bitmap, 16 * CBT_BLOCK_SIZE)).toEqual([
      { offset: 0, length: 9 * CBT_BLOCK_SIZE },
    ])
  })

  it("clamps the last extent and drops extents past the disk end", () => {
    const bitmap = Buffer.from([0x91]).toString("base64")
    const diskBytes = 3 * CBT_BLOCK_SIZE + 123

    expect(cbtBitmapToExtents(bitmap, diskBytes)).toEqual([
      { offset: 0, length: CBT_BLOCK_SIZE },
      { offset: 3 * CBT_BLOCK_SIZE, length: 123 },
    ])
  })

  it("supports a custom block size", () => {
    const bitmap = Buffer.from([0x60]).toString("base64")

    expect(cbtBitmapToExtents(bitmap, 64, 4)).toEqual([
      { offset: 4, length: 8 },
    ])
  })
})
