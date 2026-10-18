import { describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ soapRequest: vi.fn() }))
vi.mock("./soap", async (io) => {
  const actual = await io<typeof import("./soap")>()
  return { ...actual, soapRequest: h.soapRequest }
})

import {
  describeHeadroom, isThinHeadroom, parseDatastoreSummaries, parseVmDatastoreMors, soapGetDatastoreHeadroom,
} from "./datastore-headroom"

const GB = 1024 ** 3

const dsObj = (mor: string, name: string, cap: number, free: number) =>
  `<objects><obj type="Datastore">${mor}</obj>` +
  `<propSet><name>summary.capacity</name><val xsi:type="xsd:long">${cap}</val></propSet>` +
  `<propSet><name>summary.freeSpace</name><val xsi:type="xsd:long">${free}</val></propSet>` +
  `<propSet><name>summary.name</name><val xsi:type="xsd:string">${name}</val></propSet></objects>`

describe("parseVmDatastoreMors", () => {
  it("collects the distinct datastores of storage.perDatastoreUsage", () => {
    const xml = `<propSet><name>storage.perDatastoreUsage</name><val xsi:type="ArrayOfVirtualMachineUsageOnDatastore">` +
      `<VirtualMachineUsageOnDatastore><datastore type="Datastore">datastore-11</datastore><committed>1</committed></VirtualMachineUsageOnDatastore>` +
      `<VirtualMachineUsageOnDatastore><datastore type="Datastore">datastore-11</datastore><committed>2</committed></VirtualMachineUsageOnDatastore>` +
      `<VirtualMachineUsageOnDatastore><datastore type="Datastore">datastore-20</datastore><committed>3</committed></VirtualMachineUsageOnDatastore></val></propSet>`
    expect(parseVmDatastoreMors(xml)).toEqual(["datastore-11", "datastore-20"])
    expect(parseVmDatastoreMors("")).toEqual([])
  })
})

describe("parseDatastoreSummaries / isThinHeadroom / describeHeadroom", () => {
  it("reads one entry per datastore object", () => {
    const d = parseDatastoreSummaries(`<returnval>${dsObj("datastore-11", "Datastore", 600 * GB, 489 * GB)}${dsObj("datastore-20", "Datastore (1)", 100 * GB, 4 * GB)}</returnval>`)
    expect(d).toEqual([
      { mor: "datastore-11", name: "Datastore", capacityBytes: 600 * GB, freeBytes: 489 * GB },
      { mor: "datastore-20", name: "Datastore (1)", capacityBytes: 100 * GB, freeBytes: 4 * GB },
    ])
    expect(isThinHeadroom(d[0])).toBe(false)
    expect(isThinHeadroom(d[1])).toBe(true)
  })

  it("flags a datastore under 10 % free even when the absolute size is large", () => {
    expect(isThinHeadroom({ mor: "d", name: "big", capacityBytes: 10000 * GB, freeBytes: 500 * GB })).toBe(true)
    expect(isThinHeadroom({ mor: "d", name: "big", capacityBytes: 10000 * GB, freeBytes: 1500 * GB })).toBe(false)
  })

  it("describes the headroom and warns about parallel snapshots when thin", () => {
    expect(describeHeadroom({ mor: "d", name: "Datastore", capacityBytes: 600 * GB, freeBytes: 489 * GB })).toBe(`Source datastore "Datastore": 489.0 GB free of 600.0 GB (82%)`)
    expect(describeHeadroom({ mor: "d", name: "Datastore (1)", capacityBytes: 100 * GB, freeBytes: 4 * GB })).toMatch(/4\.0 GB free of 100\.0 GB \(4%\)\. The snapshot this migration holds grows .* other warm jobs on the same datastore/)
  })

  it("skips objects without numbers", () => {
    expect(parseDatastoreSummaries(`<objects><obj type="Datastore">d1</obj><propSet><name>summary.name</name><val>x</val></propSet></objects>`)).toEqual([])
  })
})

describe("soapGetDatastoreHeadroom", () => {
  it("asks for every valid moref in one call and parses the answer", async () => {
    h.soapRequest.mockResolvedValue({ text: `<returnval>${dsObj("datastore-11", "Datastore", 600 * GB, 489 * GB)}</returnval>` })
    const s = { baseUrl: "https://vc", cookie: "c", insecureTLS: true, propertyCollector: "pc" } as any
    const d = await soapGetDatastoreHeadroom(s, ["datastore-11", "bad moref"])
    expect(d).toHaveLength(1)
    const body = h.soapRequest.mock.calls[0][1] as string
    expect(body).toContain(`<urn:obj type="Datastore">datastore-11</urn:obj>`)
    expect(body).not.toContain("bad moref")
  })
  it("does nothing without a moref", async () => {
    h.soapRequest.mockClear()
    expect(await soapGetDatastoreHeadroom({} as any, [])).toEqual([])
    expect(h.soapRequest).not.toHaveBeenCalled()
  })
})
