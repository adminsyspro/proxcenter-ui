import { describe, it, expect } from "vitest"
import { parseChangedDiskAreas, cbtEligibility, parseSnapshotChangeIds } from "./cbt"

describe("parseChangedDiskAreas", () => {
  it("parses the covered window + changed extents (length is covered length, not disk size)", () => {
    const xml = `<returnval><startOffset>0</startOffset><length>16106127360</length>` +
      `<changedArea><start>0</start><length>65536</length></changedArea>` +
      `<changedArea><start>1048576</start><length>131072</length></changedArea></returnval>`
    expect(parseChangedDiskAreas(xml)).toEqual({
      startOffset: 0,
      length: 16106127360,
      extents: [{ offset: 0, length: 65536 }, { offset: 1048576, length: 131072 }],
    })
  })
  it("returns no extents for an unchanged window", () => {
    const xml = `<returnval><startOffset>0</startOffset><length>1024</length></returnval>`
    expect(parseChangedDiskAreas(xml).extents).toEqual([])
  })
})

describe("cbtEligibility", () => {
  it("accepts a modern VM with normal disks", () => {
    expect(cbtEligibility({ hwVersion: "vmx-21", disks: [{ diskMode: "persistent", sharing: "sharingNone" }] }).eligible).toBe(true)
  })
  it("rejects independent disks", () => {
    expect(cbtEligibility({ hwVersion: "vmx-21", disks: [{ diskMode: "independent_persistent", sharing: "sharingNone" }] }).eligible).toBe(false)
  })
  it("rejects multi-writer disks", () => {
    expect(cbtEligibility({ hwVersion: "vmx-21", disks: [{ diskMode: "persistent", sharing: "sharingMultiWriter" }] }).eligible).toBe(false)
  })
  it("rejects old hardware versions", () => {
    expect(cbtEligibility({ hwVersion: "vmx-04", disks: [{ diskMode: "persistent", sharing: "sharingNone" }] }).eligible).toBe(false)
  })
})

describe("parseSnapshotChangeIds", () => {
  it("maps each disk's deviceKey to its backing changeId", () => {
    const deviceXml =
      `<VirtualDevice xsi:type="VirtualDisk"><key>2000</key><backing><changeId>52 a1/0</changeId></backing></VirtualDevice>` +
      `<VirtualDevice xsi:type="VirtualDisk"><key>2001</key><backing><changeId>52 b2/3</changeId></backing></VirtualDevice>`
    const m = parseSnapshotChangeIds(deviceXml)
    expect(m.get(2000)).toBe("52 a1/0")
    expect(m.get(2001)).toBe("52 b2/3")
  })
  it("returns an empty map when there are no disks", () => {
    expect(parseSnapshotChangeIds("<no/>").size).toBe(0)
  })
})
