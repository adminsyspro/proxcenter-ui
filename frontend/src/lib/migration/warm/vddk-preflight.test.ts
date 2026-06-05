import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildPreflightCmd, parsePreflightOutput, checkVddkPreflight } from "./vddk-preflight"

vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() }
})
import { executeSSH } from "@/lib/ssh/exec"
const mockSSH = executeSSH as unknown as ReturnType<typeof vi.fn>

const ALL_PRESENT = [
  "nbdkit=/usr/sbin/nbdkit",
  "nbd-client=/usr/sbin/nbd-client",
  "vddk-plugin=/usr/lib/x86_64-linux-gnu/nbdkit/plugins/nbdkit-vddk-plugin.so",
  "vddk-lib=/opt/vddk/lib64/libvixDiskLib.so.9",
].join("\n")

describe("buildPreflightCmd", () => {
  it("probes nbdkit, nbd-client, the vddk plugin, and the VDDK lib under libdir", () => {
    const cmd = buildPreflightCmd("/opt/vddk")
    expect(cmd).toContain("command -v nbdkit")
    expect(cmd).toContain("command -v nbd-client")
    expect(cmd).toContain("nbdkit-vddk-plugin.so")
    expect(cmd).toContain("'/opt/vddk'/lib64/libvixDiskLib.so")
  })
})

describe("parsePreflightOutput", () => {
  it("reports ok when every dependency is present", () => {
    const r = parsePreflightOutput(ALL_PRESENT, "/opt/vddk")
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
  })
  it("flags a missing binary with an actionable hint", () => {
    const out = ALL_PRESENT.replace("nbdkit=/usr/sbin/nbdkit", "nbdkit=MISSING")
    const r = parsePreflightOutput(out, "/opt/vddk")
    expect(r.ok).toBe(false)
    expect(r.missing).toContain("nbdkit")
    expect(r.error).toMatch(/apt install nbdkit/i)
  })
  it("flags a missing VDDK library with the 9.x symlink hint", () => {
    const out = ALL_PRESENT.replace(/vddk-lib=.*/, "vddk-lib=")
    const r = parsePreflightOutput(out, "/opt/vddk")
    expect(r.ok).toBe(false)
    expect(r.missing).toContain("vddk-lib")
    expect(r.error).toMatch(/libvixDiskLib|VDDK|symlink/i)
  })
})

describe("checkVddkPreflight", () => {
  beforeEach(() => mockSSH.mockReset())
  it("returns ok when the node has every dependency", async () => {
    mockSSH.mockResolvedValue({ success: true, output: ALL_PRESENT })
    const r = await checkVddkPreflight("conn", "10.99.99.201", "/opt/vddk")
    expect(r.ok).toBe(true)
  })
  it("surfaces a clear error when the SSH probe itself fails", async () => {
    mockSSH.mockResolvedValue({ success: false, error: "connection refused" })
    const r = await checkVddkPreflight("conn", "10.99.99.201", "/opt/vddk")
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/connection refused|preflight/i)
  })
})
