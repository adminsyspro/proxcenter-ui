import { describe, it, expect } from "vitest"
import { mapXoToPveConfig } from "./xcpngConfigMapper"
import type { XoVmConfig } from "@/lib/xcpng/client"

function makeConfig(overrides: Partial<XoVmConfig> = {}): XoVmConfig {
  return {
    uuid: "xo-uuid-1234",
    name: "test-vm",
    powerState: "Running",
    numCPU: 2,
    memoryMB: 2048,
    firmware: "bios",
    virtualizationMode: "hvm",
    guestOS: "Ubuntu 22.04 LTS",
    tags: [],
    snapshotCount: 0,
    disks: [{ vdiUuid: "vdi-1", label: "disk0", sizeBytes: 10737418240, position: 0, srUuid: "sr-1" }],
    networks: [{ device: "0", mac: "aa:bb:cc:dd:ee:ff", network: "Pool-wide network" }],
    ...overrides,
  }
}

describe("mapXoToPveConfig — controller and boot disk bus (#653)", () => {
  it("uses virtio-scsi-single + virtio NIC for Linux, boot disk on scsi0", () => {
    const p = mapXoToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0")
    expect(p.scsihw).toBe("virtio-scsi-single")
    expect(p.nets.net0.startsWith("virtio,")).toBe(true)
    expect(p.bootDiskSlot).toBe("scsi0")
    expect(p.boot).toBe("order=scsi0")
  })

  it("keeps virtio-scsi-single but boots Windows from SATA (no inbox LSI/VirtIO boot driver)", () => {
    const p = mapXoToPveConfig(
      makeConfig({ guestOS: "Windows Server 2022 Standard" }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.scsihw).toBe("virtio-scsi-single")
    expect(p.nets.net0.startsWith("e1000,")).toBe(true)
    expect(p.bootDiskSlot).toBe("sata0")
    expect(p.boot).toBe("order=sata0")
  })

  it("boots UEFI guests from SATA regardless of OS and creates an EFI disk", () => {
    const p = mapXoToPveConfig(makeConfig({ firmware: "uefi" }), 100, "local-lvm", "vmbr0")
    expect(p.bootDiskSlot).toBe("sata0")
    expect(p.boot).toBe("order=sata0")
    expect(p.efidisk0).toBeDefined()
  })
})

describe("mapXoToPveConfig — CPU type (roadmap#24)", () => {
  it("defaults the created VM to the Proxmox default, x86-64-v2-AES, not host", () => {
    expect(mapXoToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0").cpu).toBe("x86-64-v2-AES")
  })

  it("applies the CPU type the operator picked", () => {
    expect(mapXoToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0", undefined, "x86-64-v3").cpu).toBe("x86-64-v3")
  })
})

describe("mapXoToPveConfig — name sanitising", () => {
  it("folds invalid characters and trims edge hyphens", () => {
    expect(mapXoToPveConfig(makeConfig({ name: "--my vm (copy)--" }), 100, "local-lvm", "vmbr0").name).toBe("my-vm--copy")
    expect(mapXoToPveConfig(makeConfig({ name: "---" }), 100, "local-lvm", "vmbr0").name).toBe("vm")
  })
})

describe("mapXoToPveConfig — NICs and guest conversion (#1000 follow-up)", () => {
  it("maps every VIF in device order with its source MAC and the VLAN tag", () => {
    const p = mapXoToPveConfig(makeConfig({
      networks: [
        { device: "1", mac: "aa:bb:cc:dd:ee:02", network: "n2" },
        { device: "0", mac: "aa:bb:cc:dd:ee:01", network: "n1" },
      ],
    }), 100, "local-lvm", "vmbr1", 20)
    expect(p.nets).toEqual({
      net0: "virtio,bridge=vmbr1,macaddr=aa:bb:cc:dd:ee:01,tag=20",
      net1: "virtio,bridge=vmbr1,macaddr=aa:bb:cc:dd:ee:02,tag=20",
    })
  })

  it("still creates one NIC for a VM without VIF, and drops a malformed MAC", () => {
    expect(mapXoToPveConfig(makeConfig({ networks: [] }), 100, "local-lvm", "vmbr0").nets).toEqual({ net0: "virtio,bridge=vmbr0" })
    expect(mapXoToPveConfig(makeConfig({ networks: [{ device: "0", mac: "", network: "n" }] }), 100, "local-lvm", "vmbr0").nets.net0).toBe("virtio,bridge=vmbr0")
  })

  it("boots a converted Windows or UEFI guest from SCSI with VirtIO NICs", () => {
    const win = mapXoToPveConfig(makeConfig({ guestOS: "Windows Server 2022", firmware: "uefi" }), 100, "local-lvm", "vmbr0", undefined, undefined, { guestConverted: true })
    expect(win.bootDiskSlot).toBe("scsi0")
    expect(win.diskSlots).toEqual(["scsi0"])
    expect(win.nets.net0.startsWith("virtio,")).toBe(true)
    expect(win.efidisk0).toBeDefined()
  })
})

describe("mapXoToPveConfig: data disks of an unconverted Windows (#1173)", () => {
  const disks = (n: number) => Array.from({ length: n }, (_, i) => ({ vdiUuid: `vdi-${i}`, label: `d${i}`, sizeBytes: 1 << 30, position: i, srUuid: "sr-1" }))

  it("puts them on SATA up to the sixth slot, then on SCSI; Linux and a converted Windows stay on SCSI", () => {
    const win = makeConfig({ guestOS: "Windows Server 2025 Standard", disks: disks(8) })
    expect(mapXoToPveConfig(win, 100, "ceph").diskSlots).toEqual(["sata0", "sata1", "sata2", "sata3", "sata4", "sata5", "scsi6", "scsi7"])
    expect(mapXoToPveConfig(win, 100, "ceph", "vmbr0", undefined, undefined, { guestConverted: true }).diskSlots).toEqual(["scsi0", "scsi1", "scsi2", "scsi3", "scsi4", "scsi5", "scsi6", "scsi7"])
    expect(mapXoToPveConfig(makeConfig({ disks: disks(2) }), 100, "ceph").diskSlots).toEqual(["scsi0", "scsi1"])
  })
})
