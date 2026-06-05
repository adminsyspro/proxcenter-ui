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
  beforeEach(() => mockSSH.mockReset())
  it("parses one md5 per line into an array", async () => {
    mockSSH.mockResolvedValue({ success: true, output: "aaa\nbbb\nccc\n" })
    const sums = await scanBlockChecksums("conn", "ip", "/dev/nbd3", B, 3)
    expect(sums).toEqual(["aaa", "bbb", "ccc"])
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
  beforeEach(() => mockSSH.mockReset())
  it("scans source + target and returns the differing extents", async () => {
    mockSSH.mockImplementation(async (...args: unknown[]) => {
      const cmd = String(args[2] ?? "")
      if (cmd.includes("/dev/nbd3")) return { success: true, output: "a\nb\nc" } // source
      return { success: true, output: "a\nX\nc" } // target
    })
    const ext = await detectChangedExtentsByChecksum("conn", "ip", "/dev/nbd3", "/dev/dm-9", B, 3 * B - 1)
    expect(ext).toEqual([{ offset: B, length: B }])
  })
})
