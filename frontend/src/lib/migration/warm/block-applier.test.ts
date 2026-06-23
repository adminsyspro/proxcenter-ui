import { describe, it, expect } from "vitest"
import { buildApplyScripts, MAX_APPLY_CMD_BYTES } from "./block-applier"

const MiB = 1024 * 1024

// Count `dd if=` occurrences across every chunk.
function ddCount(scripts: string[]): number {
  return scripts.reduce((n, s) => n + (s.match(/dd if=/g) || []).length, 0)
}

describe("buildApplyScripts", () => {
  it("normalizes extents and emits one byte-accurate dd per merged extent", () => {
    const scripts = buildApplyScripts("/dev/nbd3", "/dev/dm-9",
      [{ offset: 1 * MiB, length: 4096 }, { offset: 1 * MiB + 4096, length: 4096 }], 1024 ** 3)
    // the two 4k extents fall in the same 1 MiB alignment block -> one dd, one chunk
    expect(scripts).toHaveLength(1)
    expect(ddCount(scripts)).toBe(1)
    expect(scripts[0]).toContain("seek=1048576")
    expect(scripts[0].split("\n")[0]).toBe("set -e")
  })

  it("emits a separate dd per disjoint extent", () => {
    const scripts = buildApplyScripts("/dev/nbd3", "/dev/dm-9",
      [{ offset: 0, length: 4096 }, { offset: 100 * MiB, length: 4096 }], 1024 ** 3)
    expect(scripts).toHaveLength(1)
    expect(ddCount(scripts)).toBe(2)
  })

  it("emits no command for an empty change set", () => {
    expect(buildApplyScripts("/dev/nbd3", "/dev/dm-9", [], 1024 ** 3)).toEqual([])
  })

  it("clamps an aligned tail to the disk length so no dd writes past EOF", () => {
    // disk = 1.5 MiB; the extent's 1 MiB-aligned end (2 MiB) is clamped to 1.5 MiB.
    const diskLen = 1.5 * MiB
    const scripts = buildApplyScripts("/dev/nbd3", "/dev/dm-9", [{ offset: 1 * MiB, length: 256 * 1024 }], diskLen)
    expect(scripts[0]).toContain("count=524288") // 0.5 MiB, clamped
    expect(scripts[0]).not.toContain("count=1048576") // would have overrun EOF
  })

  describe("command-size chunking (#445 EOF: a single 158 KB command exceeds the 128 KiB arg limit)", () => {
    // 2000 disjoint 1 MiB-aligned extents -> ~330 KB of dd lines, well past one command.
    const many = Array.from({ length: 2000 }, (_, i) => ({ offset: i * 2 * MiB, length: 4096 }))
    const diskLen = 8 * 1024 ** 3

    it("splits a large change set into multiple commands", () => {
      const scripts = buildApplyScripts("/dev/nbd3", "/dev/dm-9", many, diskLen)
      expect(scripts.length).toBeGreaterThan(1)
    })

    it("keeps every command under the per-command byte budget", () => {
      const scripts = buildApplyScripts("/dev/nbd3", "/dev/dm-9", many, diskLen)
      for (const s of scripts) expect(s.length).toBeLessThanOrEqual(MAX_APPLY_CMD_BYTES)
      // and the budget itself must stay safely under Linux MAX_ARG_STRLEN (128 KiB),
      // leaving headroom for the sudo `sh -c '...'` wrapper + single-quote escaping.
      expect(MAX_APPLY_CMD_BYTES).toBeLessThan(128 * 1024)
    })

    it("guards every command and loses no block, preserving order", () => {
      const scripts = buildApplyScripts("/dev/nbd3", "/dev/dm-9", many, diskLen)
      for (const s of scripts) expect(s.split("\n")[0]).toBe("set -e")
      expect(ddCount(scripts)).toBe(2000) // every extent applied exactly once
      // seek offsets must be globally ascending across chunk boundaries (no reorder/dup)
      const seeks = scripts.flatMap(s => [...s.matchAll(/seek=(\d+)/g)].map(m => Number(m[1])))
      expect(seeks).toHaveLength(2000)
      for (let i = 1; i < seeks.length; i++) expect(seeks[i]).toBeGreaterThan(seeks[i - 1])
    })
  })
})
