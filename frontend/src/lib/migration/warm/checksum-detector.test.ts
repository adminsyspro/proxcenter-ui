import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  diffChecksums,
  buildBlockChecksumCmd,
  scanBlockChecksums,
  detectChangedExtentsByChecksum,
} from "./checksum-detector"

vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() }
})
import { executeSSH } from "@/lib/ssh/exec"
const mockSSH = executeSSH as unknown as ReturnType<typeof vi.fn>

const B = 256 * 1024 * 1024

describe("diffChecksums", () => {
  it("returns extents for blocks whose checksums differ", () => {
    expect(diffChecksums(["a", "b", "c"], ["a", "X", "c"], B)).toEqual([{ offset: B, length: B }])
  })
  it("returns nothing when every block matches", () => {
    expect(diffChecksums(["a", "b"], ["a", "b"], B)).toEqual([])
  })
  it("flags every differing block (one extent each; the applier merges)", () => {
    expect(diffChecksums(["a", "b", "c"], ["X", "b", "Y"], B)).toEqual([
      { offset: 0, length: B },
      { offset: 2 * B, length: B },
    ])
  })
  it("treats a target block missing from the destination scan as changed", () => {
    expect(diffChecksums(["a", "b"], ["a"], B)).toEqual([{ offset: B, length: B }])
  })
})

describe("buildBlockChecksumCmd", () => {
  it("hashes each fixed block of the device over the requested range", () => {
    const cmd = buildBlockChecksumCmd("/dev/nbd3", B, 3)
    expect(cmd).toContain("seq 0 2")
    expect(cmd).toContain("dd if='/dev/nbd3'")
    expect(cmd).toContain(`bs=${B}`)
    expect(cmd).toContain("md5sum")
  })
})

describe("scanBlockChecksums", () => {
  // Braces matter: mockReset() returns the mock, and a function returned from
  // beforeEach is treated by vitest as a cleanup hook and re-invoked with NO
  // arguments after the test — which would run the mock implementation again.
  beforeEach(() => { mockSSH.mockReset() })
  it("parses one md5 per line into an array", async () => {
    mockSSH.mockResolvedValue({ success: true, output: "aaa\nbbb\nccc\n" })
    const sums = await scanBlockChecksums("conn", "ip", "/dev/nbd3", B, 3)
    expect(sums).toEqual(["aaa", "bbb", "ccc"])
  })
  it("forwards inactivityMs and onData to executeSSH", async () => {
    mockSSH.mockResolvedValue({ success: true, output: "aaa" })
    const onData = () => {}
    await scanBlockChecksums("conn", "ip", "/dev/nbd3", B, 1, { inactivityMs: 1234, onData })
    expect(mockSSH).toHaveBeenCalledTimes(1)
    expect(mockSSH.mock.calls[0][4]).toEqual({ inactivityMs: 1234, onData })
  })
  it("returns an empty list for a zero-length disk without issuing SSH", async () => {
    const sums = await scanBlockChecksums("conn", "ip", "/dev/nbd3", B, 0)
    expect(sums).toEqual([])
    expect(mockSSH).not.toHaveBeenCalled()
  })
  it("throws when the remote scan fails", async () => {
    mockSSH.mockResolvedValue({ success: false, error: "No such device" })
    await expect(scanBlockChecksums("conn", "ip", "/dev/nbd3", B, 2)).rejects.toThrow(/No such device|checksum/i)
  })
})

describe("detectChangedExtentsByChecksum", () => {
  // Braces matter: mockReset() returns the mock, and a function returned from
  // beforeEach is treated by vitest as a cleanup hook and re-invoked with NO
  // arguments after the test — which would run the mock implementation again.
  beforeEach(() => { mockSSH.mockReset() })
  it("scans source + target and returns the differing extents", async () => {
    mockSSH.mockImplementation(async (...args: unknown[]) => {
      const cmd = String(args[2] ?? "")
      if (cmd.includes("/dev/nbd3")) return { success: true, output: "a\nb\nc" } // source
      return { success: true, output: "a\nX\nc" } // target
    })
    const ext = await detectChangedExtentsByChecksum("conn", "ip", "/dev/nbd3", "/dev/dm-9", B, 3 * B - 1)
    expect(ext).toEqual([{ offset: B, length: B }])
  })

  it("reports scan progress by counting hash lines across both scans (2*numBlocks total)", async () => {
    // Stream the hashes in chunks, one of them split mid-line: the partial line
    // must not count until its newline arrives.
    mockSSH.mockImplementation(async (...args: unknown[]) => {
      const cmd = String(args[2] ?? "")
      const opts = args[4] as { onData?: (c: string) => void }
      if (cmd.includes("/dev/nbd3")) {
        opts.onData?.("a\nb")   // 1 full line + a partial
        opts.onData?.("\nc\n")  // completes "b", then "c"
        return { success: true, output: "a\nb\nc" }
      }
      opts.onData?.("a\nX\nc\n") // 3 lines in one chunk
      return { success: true, output: "a\nX\nc" }
    })
    const seen: Array<[number, number]> = []
    await detectChangedExtentsByChecksum("conn", "ip", "/dev/nbd3", "/dev/dm-9", B, 3 * B - 1,
      { onProgress: (scanned, total) => seen.push([scanned, total]) })
    expect(seen.every(([, total]) => total === 6)).toBe(true)
    // monotonic non-decreasing scanned counter…
    for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0])
    // …ending with every block of both scans counted
    expect(seen[seen.length - 1][0]).toBe(6)
  })

  it("forwards inactivityMs to both underlying scans", async () => {
    mockSSH.mockResolvedValue({ success: true, output: "a" })
    await detectChangedExtentsByChecksum("conn", "ip", "/dev/nbd3", "/dev/dm-9", B, B,
      { inactivityMs: 4321 })
    expect(mockSSH).toHaveBeenCalledTimes(2)
    for (const call of mockSSH.mock.calls) {
      expect((call[4] as { inactivityMs?: number }).inactivityMs).toBe(4321)
    }
  })

  it("stays silent (no onProgress calls) when the callback is not provided", async () => {
    mockSSH.mockImplementation(async (...args: unknown[]) => {
      const opts = args[4] as { onData?: (c: string) => void }
      opts.onData?.("a\n")
      return { success: true, output: "a" }
    })
    // No onProgress: the onData counters must not throw on the undefined callback.
    await expect(
      detectChangedExtentsByChecksum("conn", "ip", "/dev/nbd3", "/dev/dm-9", B, B),
    ).resolves.toEqual([])
  })
})
