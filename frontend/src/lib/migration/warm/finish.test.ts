import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../pve-vm-config", () => ({ pveSetVmConfig: vi.fn(), destroyPveVm: vi.fn() }))
vi.mock("./job-control", () => ({ appendLog: vi.fn(async () => {}), updateJob: vi.fn(async () => {}) }))
vi.mock("../qcow2-convert", () => ({ convertDisksToQcow2: vi.fn() }))
vi.mock("./checksum-detector", () => ({ scanBlockChecksums: vi.fn() }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))
vi.mock("@/lib/ssh/exec", async (importActual) => ({ ...(await importActual<typeof import("@/lib/ssh/exec")>()), executeSSH: vi.fn() }))

import { destroyPveVm } from "../pve-vm-config"
import { appendLog } from "./job-control"
import { executeSSH } from "@/lib/ssh/exec"
import { removeTargetVmOnFailure, unmapTargetVolumes } from "./finish"
import type { AllocatedVolume } from "../pvesm-alloc"

const conn = { baseUrl: "https://pve:8006" }
const logs = () => vi.mocked(appendLog).mock.calls.map(c => [c[1], c[2]])

beforeEach(() => {
  vi.mocked(destroyPveVm).mockReset()
  vi.mocked(appendLog).mockClear()
})

describe("removeTargetVmOnFailure (roadmap#57)", () => {
  it("removes the empty VM shell so a retry can reuse its VMID", async () => {
    vi.mocked(destroyPveVm).mockResolvedValue(undefined)

    await removeTargetVmOnFailure({ jobId: "j", pveConn: conn, node: "pve1", vmid: 113, allocatedVolumes: [{ volumeId: "c:vm-113-disk-0", devicePath: "/dev/rbd1" }] })

    expect(destroyPveVm).toHaveBeenCalledWith(conn, "pve1", 113)
    expect(logs()).toContainEqual(["Removed target VM 113 created by this migration", "warn"])
  })

  it("keeps the VM and says so when a volume holds a completed copy (#612)", async () => {
    await removeTargetVmOnFailure({ jobId: "j", pveConn: conn, node: "pve1", vmid: 113, allocatedVolumes: [{ volumeId: "c:vm-113-disk-0", devicePath: "/dev/rbd1", copied: true }] })

    expect(destroyPveVm).not.toHaveBeenCalled()
    expect(logs()[0][0]).toMatch(/^Kept target VM 113: it holds a completed copy of the source disk/)
  })

  it("stays quiet when the VM is already gone", async () => {
    vi.mocked(destroyPveVm).mockRejectedValue(new Error("Configuration file 'nodes/pve1/qemu-server/113.conf' does not exist"))

    await removeTargetVmOnFailure({ jobId: "j", pveConn: conn, node: "pve1", vmid: 113, allocatedVolumes: [] })

    expect(logs()).toEqual([])
  })

  it("names the manual command when the removal fails, and never throws", async () => {
    vi.mocked(destroyPveVm).mockRejectedValue(new Error("VM is locked (create)"))

    await expect(removeTargetVmOnFailure({ jobId: "j", pveConn: conn, node: "pve1", vmid: 113, allocatedVolumes: [] })).resolves.toBeUndefined()

    expect(logs()).toEqual([[
      "Could not remove target VM 113: VM is locked (create). Remove it with 'qm destroy 113 --purge --destroy-unreferenced-disks' before retrying with the same VMID.",
      "warn",
    ]])
  })
})

describe("unmapTargetVolumes (roadmap#57)", () => {
  beforeEach(() => vi.mocked(executeSSH).mockReset())

  it("releases every kernel RBD mapping of the copy, kept volumes included", async () => {
    vi.mocked(executeSSH).mockResolvedValue({ success: true, output: "" })
    const vols: AllocatedVolume[] = [
      { volumeId: "c:vm-1-disk-0", devicePath: "/dev/rbd2", rbdMapped: true, copied: true },
      { volumeId: "c:vm-1-disk-1", devicePath: "/dev/rbd3", rbdMapped: true },
      { volumeId: "z:vm-1-disk-2", devicePath: "/dev/zvol/z/vm-1-disk-2" },
    ]

    await unmapTargetVolumes("conn", "10.0.0.1", vols)

    expect(vi.mocked(executeSSH).mock.calls.map(c => c[2])).toEqual([
      "rbd unmap '/dev/rbd2' 2>/dev/null",
      "rbd unmap '/dev/rbd3' 2>/dev/null",
    ])
    expect(vols.map(v => v.rbdMapped)).toEqual([false, false, undefined])
  })

  it("keeps the flag when the unmap fails, and never throws", async () => {
    vi.mocked(executeSSH).mockRejectedValueOnce(new Error("ssh down"))
    const vols: AllocatedVolume[] = [{ volumeId: "c:vm-1-disk-0", devicePath: "/dev/rbd2", rbdMapped: true }]

    await expect(unmapTargetVolumes("conn", "10.0.0.1", vols)).resolves.toBeUndefined()

    expect(vols[0].rbdMapped).toBe(true)
  })

  it("does nothing before the node is known", async () => {
    await unmapTargetVolumes("conn", "", [{ volumeId: "c:vm-1-disk-0", devicePath: "/dev/rbd2", rbdMapped: true }])
    expect(executeSSH).not.toHaveBeenCalled()
  })
})

describe("attachDisksAndBoot NICs after a guest conversion (#1000)", () => {
  it("sets the VirtIO NICs in the same call as the disks", async () => {
    const { pveSetVmConfig } = await import("../pve-vm-config")
    const { attachDisksAndBoot } = await import("./finish")
    vi.mocked(pveSetVmConfig).mockResolvedValue(undefined as any)
    await attachDisksAndBoot({
      jobId: "j", pveConn: conn, node: "pve1", vmid: 7, diskCount: 1, diskSlots: ["scsi0"], bootDiskSlot: "scsi0",
      allocatedVolumes: [{ volumeId: "c:vm-7-disk-1", devicePath: "/dev/rbd1" }], startAfterMigration: false, convertDisksToQcow2: false,
      targetStorage: "c", nets: { net0: "virtio,bridge=vmbr0" },
    })
    const body = vi.mocked(pveSetVmConfig).mock.calls.at(-1)![3] as URLSearchParams
    expect(body.get("scsi0")).toBe("c:vm-7-disk-1")
    expect(body.get("net0")).toBe("virtio,bridge=vmbr0")
    expect(body.get("boot")).toBe("order=scsi0")
  })
})
