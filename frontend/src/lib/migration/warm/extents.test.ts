import { describe, it, expect } from "vitest"
import { normalizeExtents } from "./extents"

describe("normalizeExtents", () => {
  it("sorts, merges overlapping and adjacent extents", () => {
    expect(normalizeExtents([{ offset: 100, length: 50 }, { offset: 0, length: 100 }, { offset: 150, length: 10 }]))
      .toEqual([{ offset: 0, length: 160 }])
  })
  it("aligns to a block boundary", () => {
    expect(normalizeExtents([{ offset: 10, length: 20 }], 16))
      .toEqual([{ offset: 0, length: 32 }])
  })
  it("keeps disjoint extents separate", () => {
    expect(normalizeExtents([{ offset: 0, length: 10 }, { offset: 100, length: 10 }]))
      .toEqual([{ offset: 0, length: 10 }, { offset: 100, length: 10 }])
  })
  it("clamps an aligned tail to the disk length (no over-read past EOF)", () => {
    // disk is 100 bytes; an extent at 90..100 aligned to 16 would round end to 112 -> clamp to 100
    expect(normalizeExtents([{ offset: 90, length: 10 }], 16, 100))
      .toEqual([{ offset: 80, length: 20 }])
  })
})
