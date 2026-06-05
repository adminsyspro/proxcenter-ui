import { describe, it, expect } from "vitest"
import { buildApplyScript } from "./block-applier"

const MiB = 1024 * 1024

describe("buildApplyScript", () => {
  it("normalizes extents and emits one byte-accurate dd per merged extent", () => {
    const s = buildApplyScript("/dev/nbd3", "/dev/dm-9",
      [{ offset: 1 * MiB, length: 4096 }, { offset: 1 * MiB + 4096, length: 4096 }], 1024 ** 3)
    // the two 4k extents fall in the same 1 MiB alignment block -> one dd
    expect((s.match(/dd if=/g) || []).length).toBe(1)
    expect(s).toContain("seek=1048576")
    expect(s.split("\n")[0]).toBe("set -e")
  })

  it("emits a separate dd per disjoint extent", () => {
    const s = buildApplyScript("/dev/nbd3", "/dev/dm-9",
      [{ offset: 0, length: 4096 }, { offset: 100 * MiB, length: 4096 }], 1024 ** 3)
    expect((s.match(/dd if=/g) || []).length).toBe(2)
  })

  it("emits no dd for an empty change set (just the guard header)", () => {
    const s = buildApplyScript("/dev/nbd3", "/dev/dm-9", [], 1024 ** 3)
    expect(s).toBe("set -e")
  })

  it("clamps an aligned tail to the disk length so no dd writes past EOF", () => {
    // disk = 1.5 MiB; the extent's 1 MiB-aligned end (2 MiB) is clamped to 1.5 MiB.
    const diskLen = 1.5 * MiB
    const s = buildApplyScript("/dev/nbd3", "/dev/dm-9", [{ offset: 1 * MiB, length: 256 * 1024 }], diskLen)
    expect(s).toContain("count=524288") // 0.5 MiB, clamped
    expect(s).not.toContain("count=1048576") // would have overrun EOF
  })
})
