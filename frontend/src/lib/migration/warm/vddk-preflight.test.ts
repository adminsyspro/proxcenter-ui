import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildPreflightCmd, parsePreflightOutput, checkVddkPreflight, runWarmNodePreflight } from "./vddk-preflight"

vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() }
})
import { executeSSH } from "@/lib/ssh/exec"
const mockSSH = executeSSH as unknown as ReturnType<typeof vi.fn>

// runWarmNodePreflight resolves the node IP exactly like the warm engine does,
// so the dialog verdict matches what runWarmMigration checks at planning time.
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn(async () => ({ baseUrl: "https://pve.local:8006" })),
}))
vi.mock("../pve-tasks", () => ({
  getNodeIpForMigration: vi.fn(async () => "10.0.0.7"),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))
import { getNodeIpForMigration } from "../pve-tasks"
const mockNodeIp = getNodeIpForMigration as unknown as ReturnType<typeof vi.fn>

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

describe("runWarmNodePreflight", () => {
  beforeEach(() => {
    mockSSH.mockReset()
    mockNodeIp.mockClear()
    mockNodeIp.mockResolvedValue("10.0.0.7")
  })

  it("resolves the node IP the way the engine does, then probes that node (default libdir)", async () => {
    mockSSH.mockResolvedValue({ success: true, output: ALL_PRESENT })
    const r = await runWarmNodePreflight("conn", "pve1")
    expect(r.ok).toBe(true)
    // Engine parity: getNodeIpForMigration(prisma, connId, node, baseUrl)
    expect(mockNodeIp).toHaveBeenCalledWith(expect.anything(), "conn", "pve1", "https://pve.local:8006")
    // Probe ran against the resolved IP, with the engine's default libdir.
    expect(mockSSH).toHaveBeenCalledWith("conn", "10.0.0.7", expect.stringContaining("vmware-vix-disklib"))
  })

  it("honours a custom vddkLibdir so the verdict matches the migration's libdir", async () => {
    mockSSH.mockResolvedValue({ success: true, output: ALL_PRESENT })
    await runWarmNodePreflight("conn", "pve1", "/opt/vddk")
    expect(mockSSH).toHaveBeenCalledWith("conn", "10.0.0.7", expect.stringContaining("'/opt/vddk'/lib64/libvixDiskLib.so"))
  })

  it("returns no-go with the missing deps when the node is not prepared", async () => {
    mockSSH.mockResolvedValue({ success: true, output: "nbdkit=MISSING\nnbd-client=MISSING\nvddk-plugin=\nvddk-lib=" })
    const r = await runWarmNodePreflight("conn", "pve1")
    expect(r.ok).toBe(false)
    expect(r.missing).toContain("vddk-plugin")
    expect(r.missing).toContain("vddk-lib")
  })
})
