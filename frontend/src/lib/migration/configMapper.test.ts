import { describe, it, expect } from "vitest"
import { describeHardwareChanges, efiDiskValue, mapEsxiToPveConfig, planDiskSlots, virtioDevices, withoutVirtioChoices } from "./configMapper"
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

describe("mapEsxiToPveConfig — VM name sanitising", () => {
  it.each([
    ["--my vm--", "my-vm"],
    ["a--b---", "a--b"],
    ["***", "vm"],
    ["plain", "plain"],
  ])("maps %j to %j", (name, expected) => {
    expect(mapEsxiToPveConfig(makeConfig({ name }), 100, "local-lvm", "vmbr0").name).toBe(expected)
  })
})

describe("mapEsxiToPveConfig — NIC MAC preservation", () => {
  it("preserves the source NIC MAC on net0", () => {
    const p = mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0")
    expect(p.nets.net0).toContain(",macaddr=00:50:56:aa:bb:cc")
  })

  it("omits macaddr when the source NIC has no MAC", () => {
    const p = mapEsxiToPveConfig(
      makeConfig({ nics: [{ label: "nic1", type: "Vmxnet3", macAddress: "", network: "VM Network" }] }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.nets.net0).not.toContain("macaddr=")
  })

  it("omits macaddr when the source MAC is malformed", () => {
    const p = mapEsxiToPveConfig(
      makeConfig({ nics: [{ label: "nic1", type: "Vmxnet3", macAddress: "not-a-mac", network: "VM Network" }] }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.nets.net0).not.toContain("macaddr=")
  })

  it("keeps both the preserved MAC and the VLAN tag", () => {
    const p = mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0", 42)
    expect(p.nets.net0).toContain(",macaddr=00:50:56:aa:bb:cc")
    expect(p.nets.net0).toContain(",tag=42")
  })

  it("preserves the MAC for a Windows guest (e1000 model)", () => {
    const p = mapEsxiToPveConfig(
      makeConfig({ guestId: "windows2019srv_64Guest", guestOS: "Microsoft Windows Server 2019 (64-bit)" }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.nets.net0).toMatch(/^e1000,bridge=vmbr0,macaddr=00:50:56:aa:bb:cc$/)
  })
})

describe("mapEsxiToPveConfig — controller and boot disk bus (#653)", () => {
  it("uses virtio-scsi-single + virtio NIC for Linux, boot disk on scsi0", () => {
    const p = mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0")
    expect(p.scsihw).toBe("virtio-scsi-single")
    expect(p.nets.net0.startsWith("virtio,")).toBe(true)
    expect(p.bootDiskSlot).toBe("scsi0")
    expect(p.boot).toBe("order=scsi0")
  })

  it("keeps virtio-scsi-single but boots Windows from SATA (no inbox LSI/VirtIO boot driver)", () => {
    const p = mapEsxiToPveConfig(
      makeConfig({ guestId: "windows9Server64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)" }),
      100, "local-lvm", "vmbr0",
    )
    expect(p.scsihw).toBe("virtio-scsi-single")
    expect(p.nets.net0.startsWith("e1000,")).toBe(true)
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

  it("keeps the #653 rule for SCSI sources: Windows boots from sata0, its data disks on SATA too (#1173)", () => {
    const p = mapEsxiToPveConfig(makeConfig({
      guestId: "windows9Server64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)",
      disks: [busDisk("os", "scsi", 0), busDisk("data", "scsi", 1)],
    }), 100, "local-lvm", "vmbr0")
    expect(p.diskSlots).toEqual(["sata0", "sata1"])
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

describe("mapEsxiToPveConfig — CPU type (roadmap#24)", () => {
  it("defaults the created VM to the Proxmox default, x86-64-v2-AES, not host", () => {
    expect(mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0").cpu).toBe("x86-64-v2-AES")
  })

  it("applies the CPU type the operator picked", () => {
    expect(mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0", undefined, "host").cpu).toBe("host")
  })
})

describe("mapEsxiToPveConfig: every NIC and the review-step overrides (#317)", () => {
  const twoNics = [
    { label: "Network adapter 1", type: "Vmxnet3", macAddress: "00:50:56:aa:00:01", network: "VM Network" },
    { label: "Network adapter 2", type: "E1000", macAddress: "00:50:56:aa:00:02", network: "dmz" },
  ]

  it("emits one netN per source NIC, in source order, on the default bridge", () => {
    const p = mapEsxiToPveConfig(makeConfig({ nics: twoNics }), 100, "local-lvm", "vmbr0", 7)
    expect(Object.keys(p.nets)).toEqual(["net0", "net1"])
    expect(p.nets.net0).toBe("virtio,bridge=vmbr0,macaddr=00:50:56:aa:00:01,tag=7")
    expect(p.nets.net1).toBe("e1000,bridge=vmbr0,macaddr=00:50:56:aa:00:02,tag=7")
  })

  it("puts each mapped NIC on its own bridge, tag and model, the rest on the defaults", () => {
    const p = mapEsxiToPveConfig(makeConfig({ nics: twoNics }), 100, "local-lvm", "vmbr0", undefined, "host", {
      nics: [{ index: 1, bridge: "vf95117a", vlanTag: 20, model: "virtio" }],
    })
    expect(p.nets.net0).toBe("virtio,bridge=vmbr0,macaddr=00:50:56:aa:00:01")
    expect(p.nets.net1).toBe("virtio,bridge=vf95117a,macaddr=00:50:56:aa:00:02,tag=20")
    expect(p.cpu).toBe("host")
  })

  it("lets an explicit model override the Windows e1000 rule", () => {
    const win = makeConfig({ nics: twoNics, guestId: "windows2019srv_64Guest", guestOS: "Microsoft Windows Server 2019 (64-bit)" })
    const p = mapEsxiToPveConfig(win, 100, "local-lvm", "vmbr0", undefined, undefined, { nics: [{ index: 0, bridge: "vmbr0", model: "virtio" }] })
    expect(p.nets.net0.startsWith("virtio,")).toBe(true)
    expect(p.nets.net1.startsWith("e1000,")).toBe(true)
  })

  it("applies cores, sockets and memory overrides on top of the source values", () => {
    const p = mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0", undefined, undefined, { hardware: { cores: 4, sockets: 1, memoryMB: 8192 } })
    expect([p.cores, p.sockets, p.memory]).toEqual([4, 1, 8192])
    const partial = mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0", undefined, undefined, { hardware: { memoryMB: 512 } })
    expect([partial.cores, partial.sockets, partial.memory]).toEqual([1, 2, 512])
  })

  it("still creates one default NIC for a source without any adapter", () => {
    const p = mapEsxiToPveConfig(makeConfig({ nics: [] }), 100, "local-lvm", "vmbr0", 5)
    expect(p.nets).toEqual({ net0: "virtio,bridge=vmbr0,tag=5" })
  })
})

describe("mapEsxiToPveConfig: vTPM (roadmap#1)", () => {
  it("creates an empty TPM 2.0 state on the target storage when the source has a vTPM", () => {
    const p = mapEsxiToPveConfig(makeConfig({ firmware: "efi", hasVtpm: true }), 100, "CephStoragePool", "vmbr0")
    expect(p.tpmstate0).toBe("CephStoragePool:1,version=v2.0")
    expect(p.efidisk0).toBe("CephStoragePool:1,efitype=4m,pre-enrolled-keys=1")
  })
  it("adds no TPM when the source has none", () => {
    expect(mapEsxiToPveConfig(makeConfig(), 100, "local-lvm", "vmbr0").tpmstate0).toBeUndefined()
    expect(mapEsxiToPveConfig(makeConfig({ hasVtpm: false }), 100, "local-lvm", "vmbr0").tpmstate0).toBeUndefined()
  })
})


describe("mapEsxiToPveConfig: guest conversion and forced buses (#1000)", () => {
  const scsi = (label: string, unitNumber: number) => ({
    label, fileName: `[ds] vm/${label}.vmdk`, capacityBytes: 1 << 30, thinProvisioned: true,
    datastoreName: "ds", relativePath: `vm/${label}.vmdk`, controllerType: "pvscsi", controllerKey: 1000, unitNumber,
  })
  const win = { guestId: "windows2019srvNext_64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)" }

  it("boots a converted UEFI Linux from VirtIO SCSI instead of SATA", () => {
    const cfg = makeConfig({ firmware: "efi", disks: [scsi("boot", 0), scsi("data", 1)] })
    expect(mapEsxiToPveConfig(cfg, 100, "ceph").diskSlots).toEqual(["sata0", "scsi1"])
    const p = mapEsxiToPveConfig(cfg, 100, "ceph", "vmbr0", undefined, undefined, undefined, { guestConverted: true })
    expect(p.diskSlots).toEqual(["scsi0", "scsi1"])
    expect(p.boot).toBe("order=scsi0")
  })

  it("gives a converted Windows VirtIO SCSI and VirtIO NICs, unless the operator chose a model", () => {
    const cfg = makeConfig({ ...win, disks: [scsi("c", 0)], nics: [
      { label: "a", type: "Vmxnet3", macAddress: "00:50:56:00:00:01", network: "n" },
      { label: "b", type: "Vmxnet3", macAddress: "00:50:56:00:00:02", network: "n" },
    ] })
    const plain = mapEsxiToPveConfig(cfg, 100, "ceph")
    expect(plain.bootDiskSlot).toBe("sata0")
    expect(plain.nets.net0.startsWith("e1000,")).toBe(true)
    const p = mapEsxiToPveConfig(cfg, 100, "ceph", "vmbr0", undefined, undefined, { nics: [{ index: 1, bridge: "vmbr1", model: "e1000e" }] }, { guestConverted: true })
    expect(p.bootDiskSlot).toBe("scsi0")
    expect(p.nets.net0.startsWith("virtio,")).toBe(true)
    expect(p.nets.net1.startsWith("e1000e,bridge=vmbr1")).toBe(true)
  })

  it("puts the boot disk where the operator forced it, whatever the rule says", () => {
    const cfg = makeConfig({ firmware: "efi", disks: [scsi("boot", 0), scsi("data", 1)] })
    const forcedScsi = mapEsxiToPveConfig(cfg, 100, "ceph", "vmbr0", undefined, undefined, undefined, { buses: ["scsi", undefined] })
    expect(forcedScsi.diskSlots).toEqual(["scsi0", "scsi1"])
    // A converted guest forced back onto SATA stays there.
    const forcedSata = mapEsxiToPveConfig(cfg, 100, "ceph", "vmbr0", undefined, undefined, undefined, { buses: ["sata", "sata"], guestConverted: true })
    expect(forcedSata.diskSlots).toEqual(["sata0", "sata1"])
    expect(forcedSata.boot).toBe("order=sata0")
  })

  it("moves a forced data disk off its source bus, and 'auto' changes nothing", () => {
    const sata = { ...scsi("cd", 0), controllerType: "sata", controllerKey: 15000 }
    expect(planDiskSlots([scsi("boot", 0), sata], { bootOnSata: false, buses: ["auto", "scsi"] })).toEqual(["scsi0", "scsi1"])
    expect(planDiskSlots([scsi("boot", 0), sata], { bootOnSata: false, buses: ["auto", "auto"] })).toEqual(["scsi0", "sata0"])
  })

  it("builds the EFI disk with or without the Secure Boot keys", () => {
    const cfg = makeConfig({ firmware: "efi" })
    expect(mapEsxiToPveConfig(cfg, 100, "ceph").efidisk0).toBe("ceph:1,efitype=4m,pre-enrolled-keys=1")
    expect(mapEsxiToPveConfig(cfg, 100, "ceph", "vmbr0", undefined, undefined, { hardware: { efiPreEnrolledKeys: false } }).efidisk0)
      .toBe("ceph:1,efitype=4m,pre-enrolled-keys=0")
    expect(efiDiskValue("lvm", true)).toBe("lvm:1,efitype=4m,pre-enrolled-keys=1")
    expect(efiDiskValue("lvm")).toBe("lvm:1,efitype=4m,pre-enrolled-keys=1")
  })
})

describe("mapEsxiToPveConfig: SATA source disks of a converted guest (#1000)", () => {
  const disk = (label: string, controllerType: string, unitNumber: number, controllerKey: number) => ({
    label, fileName: `[ds] vm/${label}.vmdk`, capacityBytes: 1 << 30, thinProvisioned: true,
    datastoreName: "ds", relativePath: `vm/${label}.vmdk`, controllerType, controllerKey, unitNumber,
  })

  it("moves them to VirtIO SCSI once converted, and leaves IDE disks alone", () => {
    const cfg = makeConfig({ guestId: "windows2019srvNext_64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)", disks: [disk("c", "sata", 0, 15000), disk("d", "sata", 1, 15000), disk("e", "ide", 0, 200)] })
    expect(mapEsxiToPveConfig(cfg, 100, "ceph").diskSlots).toEqual(["sata0", "sata1", "ide0"])
    const p = mapEsxiToPveConfig(cfg, 100, "ceph", "vmbr0", undefined, undefined, undefined, { guestConverted: true })
    expect(p.diskSlots).toEqual(["scsi0", "scsi1", "ide0"])
    expect(p.boot).toBe("order=ide0")
  })
})

describe("mapEsxiToPveConfig: NICs of a converted guest (#1000, lab 19/10)", () => {
  it("turns an E1000/E1000e source adapter into VirtIO once the guest is converted", () => {
    const cfg = makeConfig({ guestId: "windows2019srvNext_64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)", nics: [{ label: "a", type: "E1000e", macAddress: "00:50:56:9c:a1:f0", network: "VM Network" }] })
    expect(mapEsxiToPveConfig(cfg, 100, "ceph").nets.net0).toBe("e1000,bridge=vmbr0,macaddr=00:50:56:9c:a1:f0")
    expect(mapEsxiToPveConfig(cfg, 100, "ceph", "vmbr0", undefined, undefined, undefined, { guestConverted: true }).nets.net0).toBe("virtio,bridge=vmbr0,macaddr=00:50:56:9c:a1:f0")
    const linux = makeConfig({ nics: [{ label: "a", type: "E1000", macAddress: "00:50:56:9c:a1:f1", network: "n" }] })
    expect(mapEsxiToPveConfig(linux, 100, "ceph").nets.net0.startsWith("e1000,")).toBe(true)
    expect(mapEsxiToPveConfig(linux, 100, "ceph", "vmbr0", undefined, undefined, undefined, { guestConverted: true }).nets.net0.startsWith("virtio,")).toBe(true)
  })
})

describe("mapEsxiToPveConfig: a Windows without the VirtIO drivers (#1173)", () => {
  const disk = (label: string, unitNumber: number) => ({
    label, fileName: `[ds] vm/${label}.vmdk`, capacityBytes: 1 << 30, thinProvisioned: true,
    datastoreName: "ds", relativePath: `vm/${label}.vmdk`, controllerType: "pvscsi", controllerKey: 1000, unitNumber,
  })
  const win = { guestId: "windows2022srvNext_64Guest", guestOS: "Microsoft Windows Server 2025 (64-bit)", firmware: "efi" as const }
  const nic = { label: "a", type: "Vmxnet3", macAddress: "00:50:56:9c:19:0f", network: "VM Network" }

  it("puts every data disk on SATA up to the sixth slot, then on SCSI", () => {
    const cfg = makeConfig({ ...win, disks: Array.from({ length: 8 }, (_, i) => disk(`d${i}`, i)) })
    expect(mapEsxiToPveConfig(cfg, 100, "ceph").diskSlots).toEqual(["sata0", "sata1", "sata2", "sata3", "sata4", "sata5", "scsi6", "scsi7"])
  })

  it("keeps a Linux data disk on SCSI, and a converted Windows on SCSI", () => {
    expect(mapEsxiToPveConfig(makeConfig({ disks: [disk("os", 0), disk("data", 1)] }), 100, "ceph").diskSlots).toEqual(["scsi0", "scsi1"])
    const cfg = makeConfig({ ...win, disks: [disk("os", 0), disk("data", 1)] })
    expect(mapEsxiToPveConfig(cfg, 100, "ceph", "vmbr0", undefined, undefined, undefined, { guestConverted: true }).diskSlots).toEqual(["scsi0", "scsi1"])
  })

  it("drops the review step's VirtIO choices and says what moved", () => {
    const cfg = makeConfig({ ...win, disks: [disk("os", 0), disk("data", 1)], nics: [nic] })
    const overrides = { nics: [{ index: 0, bridge: "vmbr1", vlanTag: 20, model: "virtio" }] }
    const buses = [undefined, "scsi" as const]
    const chosen = mapEsxiToPveConfig(cfg, 100, "ceph", "vmbr0", undefined, undefined, overrides, { buses })
    expect(chosen.diskSlots).toEqual(["sata0", "scsi1"])
    expect(virtioDevices(chosen)).toEqual(["scsi1", "net0"])

    const inbox = withoutVirtioChoices(overrides, buses)
    expect(inbox.buses).toEqual([undefined, undefined])
    expect(inbox.overrides.nics).toEqual([{ index: 0, bridge: "vmbr1", vlanTag: 20, model: undefined }])
    const fallback = mapEsxiToPveConfig(cfg, 100, "ceph", "vmbr0", undefined, undefined, inbox.overrides, { buses: inbox.buses })
    expect(fallback.diskSlots).toEqual(["sata0", "sata1"])
    expect(fallback.nets.net0).toBe("e1000,bridge=vmbr1,macaddr=00:50:56:9c:19:0f,tag=20")
    expect(virtioDevices(fallback)).toEqual([])
    expect(describeHardwareChanges(chosen, fallback)).toEqual(["Disk 2 scsi1 → sata1", "net0 virtio → e1000"])
    expect(describeHardwareChanges(fallback, fallback)).toEqual([])
  })

  it("keeps the other choices: a forced SATA bus, an E1000 or vmxnet3 model, no override at all", () => {
    expect(withoutVirtioChoices({}, ["sata"])).toEqual({ overrides: {}, buses: ["sata"] })
    expect(withoutVirtioChoices({ nics: [{ index: 0, bridge: "vmbr0", model: "vmxnet3" }] }, []).overrides.nics?.[0].model).toBe("vmxnet3")
  })
})
