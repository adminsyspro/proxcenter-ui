import { describe, it, expect } from "vitest"
import { parseChangedDiskAreas, cbtEligibility } from "./cbt"

describe("parseChangedDiskAreas", () => {
  it("parses changed areas into extents and the disk length", () => {
    const xml = `<returnval><startOffset>0</startOffset><length>16106127360</length>` +
      `<changedArea><start>0</start><length>65536</length></changedArea>` +
      `<changedArea><start>1048576</start><length>131072</length></changedArea></returnval>`
    expect(parseChangedDiskAreas(xml)).toEqual({
      diskLength: 16106127360,
      extents: [{ offset: 0, length: 65536 }, { offset: 1048576, length: 131072 }],
    })
  })
  it("returns no extents for an unchanged disk", () => {
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
