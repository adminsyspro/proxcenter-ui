import { describe, expect, it, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ soapRequest: vi.fn() }))
vi.mock("./soap", async (io) => {
  const actual = await io<typeof import("./soap")>()
  return { ...actual, soapRequest: h.soapRequest }
})

import {
  buildCopyInterfaces, parseHostVnics, parseNetConfigSelection, pickDefaultCopyDevice, planBackupNfcTag,
  soapGetHostCopyInterfaces, soapGetVmHostMor, soapGetVmCopyInterfaces, soapSelectVnicForNicType, soapDeselectVnicForNicType,
  type HostCopyInterfaces,
} from "./vmkernel"

const vnic = (device: string, ip: string, portgroup: string, extra = "") =>
  `<HostVirtualNic xsi:type="HostVirtualNic"><device>${device}</device><key>key-vim.host.VirtualNic-${device}</key><portgroup>${portgroup}</portgroup>` +
  `<spec><ip><dhcp>false</dhcp><ipAddress>${ip}</ipAddress><subnetMask>255.255.255.0</subnetMask></ip><mac>00:50:56:6${device.at(-1)}:00:01</mac><mtu>1500</mtu>${extra}</spec></HostVirtualNic>`

const VNICS = `<val xsi:type="ArrayOfHostVirtualNic">${vnic("vmk0", "10.42.0.21", "Management Network")}${vnic("vmk1", "192.168.1.103", "vSAN")}${vnic("vmk2", "10.42.53.21", "r53-backup")}</val>`

// vCenter 8 prefixes each selection with its NIC type ("management.key-vim…");
// the management entry below carries the prefix, the others the bare key, so
// both spellings are exercised.
const netConfig = (type: string, selected: string[], candidates = ["vmk0", "vmk1", "vmk2"]) =>
  `<VirtualNicManagerNetConfig xsi:type="VirtualNicManagerNetConfig"><nicType>${type}</nicType><multiSelectAllowed>false</multiSelectAllowed>` +
  candidates.map(c => `<candidateVnic>${vnic(c, "0.0.0.0", "x")}</candidateVnic>`).join("") +
  selected.map(s => `<selectedVnic>${type === "management" ? `${type}.` : ""}key-vim.host.VirtualNic-${s}</selectedVnic>`).join("") +
  `</VirtualNicManagerNetConfig>`

const NETCFG = `<val xsi:type="ArrayOfVirtualNicManagerNetConfig">${netConfig("management", ["vmk0"])}${netConfig("vsan", ["vmk1"])}${netConfig("vSphereBackupNFC", [])}${netConfig("vmotion", [])}</val>`

const hostXml = (netcfg = NETCFG) =>
  `<returnval><objects><obj type="HostSystem">host-9</obj>` +
  `<propSet><name>config.network.vnic</name>${VNICS}</propSet>` +
  `<propSet><name>config.virtualNicManagerInfo.netConfig</name>${netcfg}</propSet>` +
  `<propSet><name>configManager.virtualNicManager</name><val type="HostVirtualNicManager" xsi:type="ManagedObjectReference">virtualNicManager-9</val></propSet>` +
  `<propSet><name>name</name><val xsi:type="xsd:string">10.42.0.21</val></propSet></objects></returnval>`

describe("parseHostVnics", () => {
  it("reads device, key, address, mask, port group, mac and mtu of each adapter", () => {
    const v = parseHostVnics(VNICS)
    expect(v.map(x => x.device)).toEqual(["vmk0", "vmk1", "vmk2"])
    expect(v[2]).toEqual({ device: "vmk2", key: "key-vim.host.VirtualNic-vmk2", address: "10.42.53.21", subnetMask: "255.255.255.0", portgroup: "r53-backup", mac: "00:50:56:62:00:01", mtu: 1500 })
  })
  it("labels a DVS-backed adapter and tolerates an adapter without address", () => {
    const v = parseHostVnics(`<HostVirtualNic><device>vmk3</device><key>k3</key><spec><ip><dhcp>true</dhcp></ip><distributedVirtualPort><switchUuid>u</switchUuid></distributedVirtualPort></spec></HostVirtualNic>`)
    expect(v).toEqual([{ device: "vmk3", key: "k3", address: "", subnetMask: undefined, portgroup: "distributed port", mac: undefined, mtu: undefined }])
  })
  it("returns nothing for an empty value", () => {
    expect(parseHostVnics("")).toEqual([])
  })
})

describe("parseNetConfigSelection", () => {
  it("returns the selected keys per NIC type and ignores the candidates", () => {
    const sel = parseNetConfigSelection(NETCFG)
    expect(sel.get("management")).toEqual(["key-vim.host.VirtualNic-vmk0"])
    expect(sel.get("vsan")).toEqual(["key-vim.host.VirtualNic-vmk1"])
    expect(sel.get("vSphereBackupNFC")).toEqual([])
    expect(sel.get("vmotion")).toEqual([])
  })
})

describe("buildCopyInterfaces / pickDefaultCopyDevice", () => {
  it("attaches the tags and defaults to management when nothing is tagged for backup NFC", () => {
    const i = buildCopyInterfaces({ hostMor: "host-9", hostName: "esx1", virtualNicManagerMor: "m", vnics: parseHostVnics(VNICS), selection: parseNetConfigSelection(NETCFG) })
    expect(i.vnics.find(v => v.device === "vmk0")?.services).toEqual(["management"])
    expect(i.vnics.find(v => v.device === "vmk1")?.services).toEqual(["vsan"])
    expect(i.vnics.find(v => v.device === "vmk2")?.services).toEqual([])
    expect(i.defaultDevice).toBe("vmk0")
  })
  it("defaults to the adapter tagged vSphereBackupNFC", () => {
    const sel = parseNetConfigSelection(`${netConfig("management", ["vmk0"])}${netConfig("vSphereBackupNFC", ["vmk2"])}`)
    const i = buildCopyInterfaces({ hostMor: "h", hostName: "esx1", virtualNicManagerMor: "m", vnics: parseHostVnics(VNICS), selection: sel })
    expect(i.defaultDevice).toBe("vmk2")
    expect(i.vnics.find(v => v.device === "vmk2")?.services).toEqual(["vSphereBackupNFC"])
  })
  it("falls back to the first addressed adapter, and to none at all", () => {
    expect(pickDefaultCopyDevice([{ device: "vmk1", key: "k", address: "1.1.1.1", services: ["vsan"] }])).toBe("vmk1")
    expect(pickDefaultCopyDevice([{ device: "vmk1", key: "k", address: "", services: ["management"] }])).toBeUndefined()
  })
})

describe("planBackupNfcTag", () => {
  const ifaces = (backup: string[]): HostCopyInterfaces => ({
    hostMor: "h", hostName: "esx1", virtualNicManagerMor: "m",
    vnics: [
      { device: "vmk0", key: "k0", address: "10.42.0.21", services: ["management"] },
      { device: "vmk1", key: "k1", address: "192.168.1.103", services: ["vsan"] },
      { device: "vmk2", key: "k2", address: "10.42.53.21", services: backup.includes("vmk2") ? ["vSphereBackupNFC"] : [] },
    ],
  })
  it("does nothing when the device already carries the tag", () => {
    expect(planBackupNfcTag(ifaces(["vmk2"]), "vmk2")).toEqual({ deselect: [] })
  })
  it("does nothing for the management adapter when nothing is tagged", () => {
    expect(planBackupNfcTag(ifaces([]), "vmk0")).toEqual({ deselect: [] })
  })
  it("tags the chosen adapter and untags the previous one", () => {
    expect(planBackupNfcTag(ifaces([]), "vmk1")).toEqual({ select: "vmk1", deselect: [] })
    expect(planBackupNfcTag(ifaces(["vmk2"]), "vmk1")).toEqual({ select: "vmk1", deselect: ["vmk2"] })
  })
  it("only untags when the operator picks management while another adapter is tagged", () => {
    expect(planBackupNfcTag(ifaces(["vmk2"]), "vmk0")).toEqual({ deselect: ["vmk2"] })
  })
  it("refuses an unknown device", () => {
    expect(() => planBackupNfcTag(ifaces([]), "vmk9")).toThrow(/vmk9 does not exist on esx1/)
  })
})

describe("SOAP callers", () => {
  const session = { baseUrl: "https://vc", cookie: "c", insecureTLS: true, propertyCollector: "propertyCollector", sessionManager: "s", rootFolder: "r", isVcenter: true } as any
  beforeEach(() => h.soapRequest.mockReset())

  it("soapGetVmHostMor reads runtime.host", async () => {
    h.soapRequest.mockResolvedValue({ text: `<propSet><name>runtime.host</name><val type="HostSystem">host-9</val></propSet>` })
    expect(await soapGetVmHostMor(session, "vm-1")).toBe("host-9")
    expect(h.soapRequest.mock.calls[0][1]).toContain(`<urn:obj type="VirtualMachine">vm-1</urn:obj>`)
  })
  it("soapGetVmHostMor fails loudly on a missing VM or host", async () => {
    h.soapRequest.mockResolvedValue({ text: `<faultstring>ManagedObjectNotFound</faultstring>` })
    await expect(soapGetVmHostMor(session, "vm-1")).rejects.toThrow(/VM not found/)
    h.soapRequest.mockResolvedValue({ text: `<propSet><name>runtime.host</name><val></val></propSet>` })
    await expect(soapGetVmHostMor(session, "vm-1")).rejects.toThrow(/did not report the host/)
  })
  it("soapGetHostCopyInterfaces assembles the adapters, tags and manager of the host", async () => {
    h.soapRequest.mockResolvedValue({ text: hostXml() })
    const i = await soapGetHostCopyInterfaces(session, "host-9")
    expect(i.hostName).toBe("10.42.0.21")
    expect(i.virtualNicManagerMor).toBe("virtualNicManager-9")
    expect(i.vnics.map(v => `${v.device}:${v.address}:${v.services.join("+")}`)).toEqual(["vmk0:10.42.0.21:management", "vmk1:192.168.1.103:vsan", "vmk2:10.42.53.21:"])
    expect(i.defaultDevice).toBe("vmk0")
  })
  it("soapGetVmCopyInterfaces replaces a localhost host name by the connection address", async () => {
    h.soapRequest
      .mockResolvedValueOnce({ text: `<propSet><name>runtime.host</name><val type="HostSystem">ha-host</val></propSet>` })
      .mockResolvedValueOnce({ text: hostXml().replace("<val xsi:type=\"xsd:string\">10.42.0.21</val>", "<val xsi:type=\"xsd:string\">localhost.localdomain</val>") })
    const i = await soapGetVmCopyInterfaces(session, "12", "10.42.0.21")
    expect(i.hostName).toBe("10.42.0.21")
    expect(i.vnics).toHaveLength(3)
  })

  it("select/deselect call HostVirtualNicManager and surface the fault", async () => {
    h.soapRequest.mockResolvedValue({ text: `<SelectVnicForNicTypeResponse/>` })
    await soapSelectVnicForNicType(session, "virtualNicManager-9", "vSphereBackupNFC", "vmk2")
    expect(h.soapRequest.mock.calls[0][1]).toContain(`<urn:SelectVnicForNicType><urn:_this type="HostVirtualNicManager">virtualNicManager-9</urn:_this><urn:nicType>vSphereBackupNFC</urn:nicType><urn:device>vmk2</urn:device>`)
    h.soapRequest.mockResolvedValue({ text: `<soapenv:Fault><faultcode>ServerFaultCode</faultcode><faultstring>Permission to perform this operation was denied.</faultstring></soapenv:Fault>` })
    await expect(soapDeselectVnicForNicType(session, "virtualNicManager-9", "vSphereBackupNFC", "vmk2")).rejects.toThrow(/DeselectVnicForNicType \(vSphereBackupNFC, vmk2\) failed: .*denied/)
  })
  it("select refuses a device that is not a vmk name and a host without manager", async () => {
    await expect(soapSelectVnicForNicType(session, "m", "vSphereBackupNFC", "vmk2; x")).rejects.toThrow(/Invalid VMkernel device/)
    await expect(soapSelectVnicForNicType(session, "", "vSphereBackupNFC", "vmk2")).rejects.toThrow(/HostVirtualNicManager/)
    expect(h.soapRequest).not.toHaveBeenCalled()
  })
})
