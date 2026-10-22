import { describe, it, expect } from "vitest"
import { mergeVirtV2vSupport, unsupportedWindowsReason, VIRT_V2V_MARKERS, windowsUnsupportedByVirtV2v } from "./virt-v2v-windows"

describe("windowsUnsupportedByVirtV2v (#1173)", () => {
  const stock = { version: "2.6.0", knows: [] }
  const u = { release: "Windows Server 2025", minVersion: "2.7.2" }

  it("names Windows Server 2025 when the binary lacks its driver directory, from the source name or virt-v2v's osinfo id", () => {
    expect(VIRT_V2V_MARKERS).toEqual(["2k25"])
    expect(windowsUnsupportedByVirtV2v("Microsoft Windows Server 2025 (64-bit)", stock)).toEqual(u)
    expect(windowsUnsupportedByVirtV2v("there are no virtio drivers available for this version of Windows (10.0 x86_64 Server win2k25)", stock)).toEqual(u)
  })

  it("trusts the binary over the version: a 2.6.0 with the backport converts it (lab)", () => {
    expect(windowsUnsupportedByVirtV2v("Microsoft Windows Server 2025 (64-bit)", { version: "2.6.0", knows: ["2k25"] })).toBeNull()
    expect(windowsUnsupportedByVirtV2v("Microsoft Windows Server 2025 (64-bit)", { version: "2.10.0", knows: ["2k25"] })).toBeNull()
  })

  it("stays quiet on another release, or when the probe did not look", () => {
    expect(windowsUnsupportedByVirtV2v("Microsoft Windows Server 2022 (64-bit)", stock)).toBeNull()
    expect(windowsUnsupportedByVirtV2v("(10.0 x86_64 Server win2k22)", stock)).toBeNull()
    expect(windowsUnsupportedByVirtV2v("Microsoft Windows Server 2025 (64-bit)", { version: "2.6.0" })).toBeNull()
    expect(windowsUnsupportedByVirtV2v("Microsoft Windows Server 2025 (64-bit)", undefined)).toBeNull()
    expect(windowsUnsupportedByVirtV2v(undefined, stock)).toBeNull()
  })

  it("blames the node's virt-v2v, not the ISO", () => {
    const r = unsupportedWindowsReason(u, "2.6.0")
    expect(r).toContain("virt-v2v 2.6.0 on this node does not support Windows Server 2025 (support starts with virt-v2v 2.7.2)")
    expect(r).toContain("although the VirtIO ISO holds them")
    expect(unsupportedWindowsReason(u, undefined).startsWith("virt-v2v on this node does not support")).toBe(true)
  })
})

describe("mergeVirtV2vSupport (cold dialog, Auto node)", () => {
  it("knows a release only when every node knows it, and offers the backport when one node takes it", () => {
    const patched = { version: "2.6.0", knows: ["2k25"] }
    const stock = { version: "2.6.0", knows: [], backport: true }
    expect(mergeVirtV2vSupport([patched, stock])).toEqual({ version: "2.6.0", knows: [], backport: true })
    expect(mergeVirtV2vSupport([patched, patched])).toEqual({ version: "2.6.0", knows: ["2k25"] })
    expect(windowsUnsupportedByVirtV2v("Microsoft Windows Server 2025 (64-bit)", mergeVirtV2vSupport([patched, stock]))).not.toBeNull()
  })

  it("says nothing when a node was not probed: no virt-v2v there, the checklist asks for it first", () => {
    expect(mergeVirtV2vSupport([{ version: "2.6.0", knows: [] }, undefined])).toBeUndefined()
    expect(mergeVirtV2vSupport([])).toBeUndefined()
    expect(mergeVirtV2vSupport([{ version: "2.6.0" }, { version: "2.6.0", knows: [] }])).toEqual({ version: "2.6.0" })
  })
})
