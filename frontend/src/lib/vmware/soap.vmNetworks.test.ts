import { describe, it, expect, vi, beforeEach } from "vitest"

// ui#1333: the networks of the bulk selection, named as the engines match
// them; a distributed-switch adapter by its port group name. The transport is
// mocked at undici, as in soap.guestIdentity.test.ts.
const undiciRequest = vi.fn()
vi.mock("undici", () => ({
  request: (...args: any[]) => undiciRequest(...args),
  Agent: class { constructor(_opts?: any) { /* no-op */ } },
}))

import { parseNicDevices, soapGetVmsNics, soapNameDistributedNics } from "./soap"

const session = { baseUrl: "https://vcenter", cookie: "c", insecureTLS: true, propertyCollector: "propertyCollector" } as any
const reply = (text: string) => ({ statusCode: 200, headers: {}, body: { text: async () => text } })
const bodyOf = (n: number) => String(undiciRequest.mock.calls[n][1].body)

const stdNic = (summary: string, mac: string) =>
  `<VirtualDevice xsi:type="VirtualVmxnet3"><key>4000</key><deviceInfo><label>Network adapter 1</label><summary>${summary}</summary></deviceInfo><backing xsi:type="VirtualEthernetCardNetworkBackingInfo"><deviceName>${summary}</deviceName></backing><macAddress>${mac}</macAddress></VirtualDevice>`
const dvsNic = (key: string, mac: string) =>
  `<VirtualDevice xsi:type="VirtualVmxnet3"><key>4001</key><deviceInfo><label>Network adapter 2</label><summary>DVSwitch: 50 2c 1a</summary></deviceInfo><backing xsi:type="VirtualEthernetCardDistributedVirtualPortBackingInfo"><port><switchUuid>50 2c 1a</switchUuid><portgroupKey>${key}</portgroupKey></port></backing><macAddress>${mac}</macAddress></VirtualDevice>`
const vmObject = (id: string, devices: string) => `<objects><obj type="VirtualMachine">${id}</obj><propSet><name>config.hardware.device</name><val xsi:type="ArrayOfVirtualDevice">${devices}</val></propSet></objects>`
const pgObject = (key: string, name: string) => `<objects><obj type="DistributedVirtualPortgroup">${key}</obj><propSet><name>name</name><val xsi:type="xsd:string">${name}</val></propSet></objects>`

beforeEach(() => { undiciRequest.mockReset() })

describe("parseNicDevices portgroupKey", () => {
  it("keeps the port group key of a distributed-switch adapter only", () => {
    const nics = parseNicDevices(stdNic("VM Network", "00:50:56:00:00:01") + dvsNic("dvportgroup-42", "00:50:56:00:00:02"))
    expect(nics.map(n => [n.network, n.portgroupKey])).toEqual([["VM Network", undefined], ["DVSwitch: 50 2c 1a", "dvportgroup-42"]])
  })
})

describe("soapGetVmsNics", () => {
  it("reads every VM in one call and names distributed adapters by port group", async () => {
    undiciRequest
      .mockResolvedValueOnce(reply(`<returnval>${vmObject("vm-1", stdNic("VM Network", "00:50:56:00:00:01") + dvsNic("dvportgroup-42", "00:50:56:00:00:02"))}${vmObject("vm-2", stdNic("LAN &amp; servers", "00:50:56:00:00:03"))}</returnval>`))
      .mockResolvedValueOnce(reply(`<returnval>${pgObject("dvportgroup-42", "DMZ-prod")}</returnval>`))
    const out = await soapGetVmsNics(session, ["vm-1", "vm-2", "vm-1", "bad id"])
    expect(out.get("vm-1")!.map(n => n.network)).toEqual(["VM Network", "DMZ-prod"])
    expect(out.get("vm-2")!.map(n => n.network)).toEqual(["LAN & servers"])
    expect(bodyOf(0).match(/<urn:obj type="VirtualMachine">/g)).toHaveLength(2)
    expect(bodyOf(1)).toContain('<urn:obj type="DistributedVirtualPortgroup">dvportgroup-42</urn:obj>')
  })

  it("asks nothing for no VM", async () => {
    expect((await soapGetVmsNics(session, [])).size).toBe(0)
    expect(undiciRequest).not.toHaveBeenCalled()
  })
})

describe("soapNameDistributedNics", () => {
  it("leaves the summary when the port group lookup fails", async () => {
    undiciRequest.mockRejectedValueOnce(new Error("socket hang up"))
    const nics = parseNicDevices(dvsNic("dvportgroup-7", "00:50:56:00:00:02"))
    await soapNameDistributedNics(session, nics)
    expect(nics[0].network).toBe("DVSwitch: 50 2c 1a")
  })

  it("asks nothing when no adapter is on a distributed switch", async () => {
    await soapNameDistributedNics(session, parseNicDevices(stdNic("VM Network", "00:50:56:00:00:01")))
    expect(undiciRequest).not.toHaveBeenCalled()
  })
})
