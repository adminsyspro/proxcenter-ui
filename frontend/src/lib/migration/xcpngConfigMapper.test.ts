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
    expect(p.net0.startsWith("virtio,")).toBe(true)
    expect(p.bootDiskSlot).toBe("scsi0")
    expect(p.boot).toBe("order=scsi0")
  })

  it("keeps virtio-scsi-single but boots Windows from SATA (no inbox LSI/VirtIO boot driver)", () => {
    const p = mapXoToPveConfig(
      makeConfig({ guestOS: "Windows Server 2022 Standard" }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.scsihw).toBe("virtio-scsi-single")
    expect(p.net0.startsWith("e1000,")).toBe(true)
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
