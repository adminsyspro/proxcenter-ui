import { describe, it, expect } from "vitest"
import { parseDiskCbtFields } from "./soap"

describe("parseDiskCbtFields", () => {
  it("extracts deviceKey, diskMode, sharing, changeId from a VirtualDisk block", () => {
    const block = `<key>2000</key><deviceInfo><label>Hard disk 1</label></deviceInfo>` +
      `<backing><fileName>[ds] vm/vm.vmdk</fileName><diskMode>persistent</diskMode><changeId>52 ab/7</changeId></backing>` +
      `<controllerKey>1000</controllerKey><capacityInBytes>16106127360</capacityInBytes><sharing>sharingNone</sharing>`
    expect(parseDiskCbtFields(block)).toEqual({ deviceKey: 2000, diskMode: "persistent", sharing: "sharingNone", changeId: "52 ab/7" })
  })

  it("returns empty defaults when fields are absent", () => {
    expect(parseDiskCbtFields("<key>2001</key>")).toEqual({ deviceKey: 2001, diskMode: "", sharing: "", changeId: "" })
  })
})
