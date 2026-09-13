import { describe, it, expect } from "vitest"
import { mapEsxiToPveConfig } from "./configMapper"
import type { EsxiVmConfig } from "@/lib/vmware/soap"

function makeConfig(overrides: Partial<EsxiVmConfig> = {}): EsxiVmConfig {
  return {
    name: "test-vm",
    guestOS: "Ubuntu Linux (64-bit)",
    guestId: "ubuntu64Guest",
    numCPU: 2,
    numCoresPerSocket: 1,
    sockets: 2,
    memoryMB: 2048,
    firmware: "bios",
    uuid: "564d-uuid",
    vmxVersion: "vmx-19",
    vmPathName: "[ds] test-vm/test-vm.vmx",
    powerState: "poweredOn",
    committed: 0,
    disks: [],
    nics: [{ label: "Network adapter 1", type: "Vmxnet3", macAddress: "00:50:56:aa:bb:cc", network: "VM Network" }],
    snapshotCount: 0,
    ...overrides,
  }
}

describe("mapEsxiToPveConfig — NIC MAC preservation", () => {
  it("preserves the source NIC MAC on net0", () => {
    const p = mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0")
    expect(p.net0).toContain(",macaddr=00:50:56:aa:bb:cc")
  })

  it("omits macaddr when the source NIC has no MAC", () => {
    const p = mapEsxiToPveConfig(
      makeConfig({ nics: [{ label: "nic1", type: "Vmxnet3", macAddress: "", network: "VM Network" }] }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.net0).not.toContain("macaddr=")
  })

  it("omits macaddr when the source MAC is malformed", () => {
    const p = mapEsxiToPveConfig(
      makeConfig({ nics: [{ label: "nic1", type: "Vmxnet3", macAddress: "not-a-mac", network: "VM Network" }] }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.net0).not.toContain("macaddr=")
  })

  it("keeps both the preserved MAC and the VLAN tag", () => {
    const p = mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0", 42)
    expect(p.net0).toContain(",macaddr=00:50:56:aa:bb:cc")
    expect(p.net0).toContain(",tag=42")
  })

  it("preserves the MAC for a Windows guest (e1000 model)", () => {
    const p = mapEsxiToPveConfig(
      makeConfig({ guestId: "windows2019srv_64Guest", guestOS: "Microsoft Windows Server 2019 (64-bit)" }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.net0).toMatch(/^e1000,bridge=vmbr0,macaddr=00:50:56:aa:bb:cc$/)
  })
})

describe("mapEsxiToPveConfig — controller and boot disk bus (#653)", () => {
  it("uses virtio-scsi-single + virtio NIC for Linux, boot disk on scsi0", () => {
    const p = mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0")
    expect(p.scsihw).toBe("virtio-scsi-single")
    expect(p.net0.startsWith("virtio,")).toBe(true)
    expect(p.bootDiskSlot).toBe("scsi0")
    expect(p.boot).toBe("order=scsi0")
  })

  it("keeps virtio-scsi-single but boots Windows from SATA (no inbox LSI/VirtIO boot driver)", () => {
    const p = mapEsxiToPveConfig(
      makeConfig({ guestId: "windows9Server64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)" }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.scsihw).toBe("virtio-scsi-single")
    expect(p.net0.startsWith("e1000,")).toBe(true)
    expect(p.bootDiskSlot).toBe("sata0")
    expect(p.boot).toBe("order=sata0")
  })

  it("boots EFI guests from SATA regardless of OS", () => {
    const p = mapEsxiToPveConfig(makeConfig({ firmware: "efi" }), 100, "local-lvm", "vmbr0")
    expect(p.bootDiskSlot).toBe("sata0")
    expect(p.boot).toBe("order=sata0")
  })
})

describe("mapEsxiToPveConfig — disk bus follows the source controller", () => {
  const ideDisk = (label: string, controllerKey: number, unitNumber: number) => ({
    label, fileName: `[ds] vm/${label}.vmdk`, capacityBytes: 1 << 30, thinProvisioned: true,
    datastoreName: "ds", relativePath: `vm/${label}.vmdk`, controllerType: "ide", controllerKey, unitNumber,
  })
  const busDisk = (label: string, controllerType: string, unitNumber: number, controllerKey = controllerType === "sata" ? 15000 : 1000) => ({
    ...ideDisk(label, controllerKey, unitNumber), controllerType,
  })

  it("keeps IDE disks on IDE at their source positions and picks the i440fx machine", () => {
    // The closed appliance of the field case: four IDE disks, no Tools, guestOS "other".
    const p = mapEsxiToPveConfig(makeConfig({
      guestId: "otherGuest", guestOS: "Other (32-bit)", toolsStatus: "toolsNotInstalled",
      disks: [ideDisk("hd-boot", 200, 0), ideDisk("hd-cf", 200, 1), ideDisk("hd-flash", 201, 0), ideDisk("hd-dump", 201, 1)],
    }), 100, "local-lvm", "vmbr0")
    expect(p.diskSlots).toEqual(["ide0", "ide1", "ide2", "ide3"])
    expect(p.bootDiskSlot).toBe("ide0")
    expect(p.boot).toBe("order=ide0")
    expect(p.machine).toBe("pc")
    expect(p.agent).toBe("0")
  })

  it("maps IDE positions from the controller and unit, not from the listing order", () => {
    const p = mapEsxiToPveConfig(makeConfig({
      disks: [ideDisk("second", 201, 0), ideDisk("first", 200, 0)],
    }), 100, "local-lvm", "vmbr0")
    expect(p.diskSlots).toEqual(["ide2", "ide0"])
    // The boot order names the disk that sits first on the bus, not the first listed.
    expect(p.boot).toBe("order=ide0")
  })

  it("keeps SATA disks on SATA and stays on q35", () => {
    const p = mapEsxiToPveConfig(makeConfig({
      disks: [busDisk("a", "sata", 0), busDisk("b", "sata", 1)],
    }), 100, "local-lvm", "vmbr0")
    expect(p.diskSlots).toEqual(["sata0", "sata1"])
    expect(p.machine).toBe("q35")
    expect(p.boot).toBe("order=sata0")
  })

  it("keeps the #653 rule for SCSI sources: Windows boots from sata0, data disks on scsi", () => {
    const p = mapEsxiToPveConfig(makeConfig({
      guestId: "windows9Server64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)",
      disks: [busDisk("os", "scsi", 0), busDisk("data", "scsi", 1)],
    }), 100, "local-lvm", "vmbr0")
    expect(p.diskSlots).toEqual(["sata0", "scsi1"])
    expect(p.machine).toBe("q35")
  })

  it("never collides a Windows SCSI boot disk with a SATA data disk", () => {
    const p = mapEsxiToPveConfig(makeConfig({
      guestId: "windows9Server64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)",
      disks: [busDisk("os", "scsi", 0), busDisk("data", "sata", 0)],
    }), 100, "local-lvm", "vmbr0")
    expect(p.diskSlots).toEqual(["sata0", "sata1"])
  })

  it("overflows past the six SATA slots of Proxmox onto SCSI", () => {
    const disks = Array.from({ length: 8 }, (_, i) => busDisk(`d${i}`, "sata", i))
    const p = mapEsxiToPveConfig(makeConfig({ disks }), 100, "local-lvm", "vmbr0")
    expect(p.diskSlots).toEqual(["sata0", "sata1", "sata2", "sata3", "sata4", "sata5", "scsi6", "scsi7"])
  })

  it("falls back to the listing order when an IDE disk carries no unit number", () => {
    const p = mapEsxiToPveConfig(makeConfig({
      disks: [{ ...ideDisk("x", 0, 0), controllerKey: undefined, unitNumber: undefined } as any, ideDisk("y", 200, 0)],
    }), 100, "local-lvm", "vmbr0")
    // "y" owns ide0 by position, "x" takes the next free IDE slot.
    expect(p.diskSlots).toEqual(["ide1", "ide0"])
  })

  it("leaves a guest with Tools installed on the QEMU agent, and a guest without any disks on the old boot slot", () => {
    expect(mapEsxiToPveConfig(makeConfig({ toolsStatus: "toolsOk" }), 100, "local-lvm", "vmbr0").agent).toBe("1")
    expect(mapEsxiToPveConfig(makeConfig({ toolsStatus: "toolsNotRunning" }), 100, "local-lvm", "vmbr0").agent).toBe("1")
    const none = mapEsxiToPveConfig(makeConfig({ disks: [] }), 100, "local-lvm", "vmbr0")
    expect(none.diskSlots).toEqual([])
    expect(none.bootDiskSlot).toBe("scsi0")
  })
})
