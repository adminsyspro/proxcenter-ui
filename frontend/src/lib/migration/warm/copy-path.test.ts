import { describe, expect, it, vi } from "vitest"

import { resolveCopyPath } from "./copy-path"
import type { HostCopyInterfaces } from "@/lib/vmware/vmkernel"

const ifaces = (backupTagged: string[] = []): HostCopyInterfaces => ({
  hostMor: "host-9", hostName: "esx1", virtualNicManagerMor: "vnm-9",
  vnics: [
    { device: "vmk0", key: "k0", address: "10.42.0.21", services: ["management"] },
    { device: "vmk1", key: "k1", address: "192.168.1.103", services: ["vsan"] },
    { device: "vmk2", key: "k2", address: "10.42.53.21", services: backupTagged.includes("vmk2") ? ["vSphereBackupNFC"] : [] },
    { device: "vmk3", key: "k3", address: "", services: [] },
  ],
  defaultDevice: backupTagged.includes("vmk2") ? "vmk2" : "vmk0",
})

function deps(i: HostCopyInterfaces | Error) {
  return {
    getHostInterfaces: vi.fn(async () => { if (i instanceof Error) throw i; return i }),
    selectVnic: vi.fn(async () => {}),
    deselectVnic: vi.fn(async () => {}),
  }
}
const esxi = { isVcenter: false } as any
const vcenter = { isVcenter: true } as any
const logs: string[] = []
const log = async (m: string) => { logs.push(m) }

describe("resolveCopyPath on a standalone ESXi source", () => {
  it("defaults to the management adapter and connects the VDDK to its address", async () => {
    const d = deps(ifaces())
    const p = await resolveCopyPath({ session: esxi, vmid: "12", connectionHost: "esx1.lab", log, deps: d })
    expect(p).toMatchObject({ server: "10.42.0.21", nfcAddress: "10.42.0.21", device: "vmk0", direct: true, hostChanges: [] })
    expect(p.label).toBe("vmk0 10.42.0.21 (management) on esx1")
    expect(d.selectVnic).not.toHaveBeenCalled()
  })

  it("prefers the vSphereBackupNFC-tagged adapter when nothing is chosen", async () => {
    const p = await resolveCopyPath({ session: esxi, vmid: "12", connectionHost: "esx1.lab", log, deps: deps(ifaces(["vmk2"])) })
    expect(p.server).toBe("10.42.53.21")
    expect(p.label).toContain("vmk2 10.42.53.21 (vSphereBackupNFC)")
  })

  it("uses the chosen adapter's address as the VDDK server and never touches the host tags", async () => {
    const d = deps(ifaces())
    const p = await resolveCopyPath({ session: esxi, vmid: "12", connectionHost: "esx1.lab", chosen: { device: "vmk2", address: "10.42.53.21" }, log, deps: d })
    expect(p).toMatchObject({ server: "10.42.53.21", nfcAddress: "10.42.53.21", device: "vmk2", direct: true, hostChanges: [] })
    expect(d.selectVnic).not.toHaveBeenCalled()
    expect(d.deselectVnic).not.toHaveBeenCalled()
  })

  it("follows the live address when the configured one is stale, and says so", async () => {
    logs.length = 0
    const p = await resolveCopyPath({ session: esxi, vmid: "12", connectionHost: "esx1.lab", chosen: { device: "vmk2", address: "10.42.53.99" }, log, deps: deps(ifaces()) })
    expect(p.server).toBe("10.42.53.21")
    expect(logs.some(l => /now has address 10\.42\.53\.21 .*configured with 10\.42\.53\.99/.test(l))).toBe(true)
  })

  it("fails loudly when the chosen adapter is gone or has no address", async () => {
    await expect(resolveCopyPath({ session: esxi, vmid: "12", connectionHost: "h", chosen: { device: "vmk9" }, log, deps: deps(ifaces()) })).rejects.toThrow(/vmk9 no longer exists on esx1/)
    await expect(resolveCopyPath({ session: esxi, vmid: "12", connectionHost: "h", chosen: { device: "vmk3" }, log, deps: deps(ifaces()) })).rejects.toThrow(/vmk3 on esx1 has no IPv4 address/)
  })

  it("names the host by the connection address when ESXi calls itself localhost.localdomain", async () => {
    const d = deps({ ...ifaces(), hostName: "localhost.localdomain" })
    const p = await resolveCopyPath({ session: esxi, vmid: "12", connectionHost: "10.42.0.21", chosen: { device: "vmk2" }, log, deps: d })
    expect(p.label).toBe("vmk2 10.42.53.21 on 10.42.0.21")
  })

  it("falls back to the connection address when the adapters cannot be read and nothing was chosen", async () => {
    logs.length = 0
    const p = await resolveCopyPath({ session: esxi, vmid: "12", connectionHost: "esx1.lab", log, deps: deps(new Error("NoPermission")) })
    expect(p).toEqual({ server: "esx1.lab", nfcAddress: "esx1.lab", label: "esx1.lab", direct: true, hostChanges: [] })
    expect(logs[0]).toMatch(/NoPermission.*esx1\.lab/)
  })

  it("refuses to run blind when an adapter was chosen but the host cannot be read", async () => {
    await expect(resolveCopyPath({ session: esxi, vmid: "12", connectionHost: "h", chosen: { device: "vmk2" }, log, deps: deps(new Error("NoPermission")) })).rejects.toThrow(/to use vmk2: NoPermission/)
  })
})

describe("resolveCopyPath on a vCenter source", () => {
  it("keeps the vCenter as VDDK server and probes the host's default adapter", async () => {
    const d = deps(ifaces())
    const p = await resolveCopyPath({ session: vcenter, vmid: "vm-10936", connectionHost: "vcsa.lab", log, deps: d })
    expect(p).toMatchObject({ server: "vcsa.lab", nfcAddress: "10.42.0.21", device: "vmk0", direct: false, hostChanges: [] })
    expect(d.selectVnic).not.toHaveBeenCalled()
  })

  it("tags the chosen adapter vSphereBackupNFC on the host and reports the change", async () => {
    const d = deps(ifaces())
    const p = await resolveCopyPath({ session: vcenter, vmid: "vm-10936", connectionHost: "vcsa.lab", chosen: { device: "vmk2", address: "10.42.53.21" }, log, deps: d })
    expect(d.selectVnic).toHaveBeenCalledWith(vcenter, "vnm-9", "vSphereBackupNFC", "vmk2")
    expect(d.deselectVnic).not.toHaveBeenCalled()
    expect(p).toMatchObject({ server: "vcsa.lab", nfcAddress: "10.42.53.21", device: "vmk2", hostChanges: ["tagged vmk2 vSphereBackupNFC"] })
    expect(p.label).toBe("vmk2 10.42.53.21 (vSphereBackupNFC) on esx1")
  })

  it("moves the tag when another adapter carried it, and only removes it when management is chosen", async () => {
    let d = deps(ifaces(["vmk2"]))
    await resolveCopyPath({ session: vcenter, vmid: "vm-1", connectionHost: "vc", chosen: { device: "vmk1" }, log, deps: d })
    expect(d.deselectVnic).toHaveBeenCalledWith(vcenter, "vnm-9", "vSphereBackupNFC", "vmk2")
    expect(d.selectVnic).toHaveBeenCalledWith(vcenter, "vnm-9", "vSphereBackupNFC", "vmk1")

    d = deps(ifaces(["vmk2"]))
    const p = await resolveCopyPath({ session: vcenter, vmid: "vm-1", connectionHost: "vc", chosen: { device: "vmk0" }, log, deps: d })
    expect(d.deselectVnic).toHaveBeenCalledWith(vcenter, "vnm-9", "vSphereBackupNFC", "vmk2")
    expect(d.selectVnic).not.toHaveBeenCalled()
    expect(p.hostChanges).toEqual(["removed the vSphereBackupNFC tag from vmk2"])
    expect(p.nfcAddress).toBe("10.42.0.21")
  })

  it("does nothing on the host when the chosen adapter already carries the tag", async () => {
    const d = deps(ifaces(["vmk2"]))
    const p = await resolveCopyPath({ session: vcenter, vmid: "vm-1", connectionHost: "vc", chosen: { device: "vmk2" }, log, deps: d })
    expect(d.selectVnic).not.toHaveBeenCalled()
    expect(d.deselectVnic).not.toHaveBeenCalled()
    expect(p.hostChanges).toEqual([])
  })

  it("surfaces a refused tag change", async () => {
    const d = deps(ifaces())
    d.selectVnic.mockRejectedValue(new Error("SelectVnicForNicType (vSphereBackupNFC, vmk2) failed: Permission to perform this operation was denied."))
    await expect(resolveCopyPath({ session: vcenter, vmid: "vm-1", connectionHost: "vc", chosen: { device: "vmk2" }, log, deps: d })).rejects.toThrow(/denied/)
  })
})
