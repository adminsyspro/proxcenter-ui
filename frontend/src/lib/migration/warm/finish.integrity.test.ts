import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../pve-vm-config", () => ({ pveSetVmConfig: vi.fn(), destroyPveVm: vi.fn() }))
vi.mock("./job-control", () => ({ appendLog: vi.fn(async () => {}), updateJob: vi.fn(async () => {}) }))
vi.mock("../qcow2-convert", () => ({ convertDisksToQcow2: vi.fn() }))
vi.mock("./checksum-detector", () => ({ scanBlockChecksums: vi.fn() }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))
vi.mock("../integrity", async (orig) => ({ ...(await orig<typeof import("../integrity")>()), verifyDiskIntegrity: vi.fn(async () => {}) }))

import { appendLog } from "./job-control"
import { verifyDiskIntegrity } from "../integrity"
import { verifyWarmDiskIntegrity } from "./finish"

const settings = { enabled: true, regionCount: 8, regionSizeMiB: 4 }
const base = { jobId: "j1", connectionId: "c1", nodeIp: "10.0.0.1" as any, diskIndex: 0, dev: "/dev/rbd0", capacityBytes: 3 * 1024 ** 3, settings }

beforeEach(() => {
  vi.mocked(appendLog).mockClear()
  vi.mocked(verifyDiskIntegrity).mockReset().mockResolvedValue(undefined as any)
})

describe("verifyWarmDiskIntegrity (roadmap#1)", () => {
  it("hands the disk over unverified, and says so, when the target cluster turned the check off", async () => {
    const openReader = vi.fn()
    await verifyWarmDiskIntegrity({ ...base, settings: { ...settings, enabled: false }, openReader })
    expect(openReader).not.toHaveBeenCalled()
    expect(verifyDiskIntegrity).not.toHaveBeenCalled()
    expect(vi.mocked(appendLog).mock.calls[0][1]).toContain("disabled on the target cluster")
  })

  it("compares the source reader with the target device, and always closes the reader", async () => {
    const close = vi.fn(async () => {})
    await verifyWarmDiskIntegrity({ ...base, openReader: async () => ({ nbdDev: "/dev/nbd3", close }) })
    expect(verifyDiskIntegrity).toHaveBeenCalledWith(expect.objectContaining({
      diskIndex: 0, source: { kind: "raw", path: "/dev/nbd3" }, target: { kind: "raw", path: "/dev/rbd0" }, settings,
    }))
    expect(close).toHaveBeenCalled()

    vi.mocked(verifyDiskIntegrity).mockRejectedValueOnce(new Error("1 of 10 sampled regions differ"))
    await expect(verifyWarmDiskIntegrity({ ...base, openReader: async () => ({ nbdDev: "/dev/nbd3", close }) })).rejects.toThrow("differ")
    expect(close).toHaveBeenCalledTimes(2)
  })

  it("fails, never hands over, when the source disk cannot be reopened for the check", async () => {
    await expect(verifyWarmDiskIntegrity({ ...base, openReader: async () => { throw new Error("vddk refused") } }))
      .rejects.toThrow("could not open the source disk 1 for verification: vddk refused")
    expect(verifyDiskIntegrity).not.toHaveBeenCalled()
  })
})
