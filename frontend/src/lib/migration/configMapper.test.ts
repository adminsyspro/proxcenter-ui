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

describe("mapEsxiToPveConfig — baseline behavior (unchanged)", () => {
  it("uses virtio-scsi-single + virtio NIC for Linux", () => {
    const p = mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0")
    expect(p.scsihw).toBe("virtio-scsi-single")
    expect(p.net0.startsWith("virtio,")).toBe(true)
  })

  it("uses lsi + e1000 NIC for Windows (no injected drivers)", () => {
    const p = mapEsxiToPveConfig(
      makeConfig({ guestId: "windows9Server64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)" }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.scsihw).toBe("lsi")
    expect(p.net0.startsWith("e1000,")).toBe(true)
  })
})
