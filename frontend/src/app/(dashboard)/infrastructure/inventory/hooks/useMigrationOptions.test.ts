import { describe, expect, it } from "vitest"

import { deriveHypervDiskPaths } from "./useMigrationOptions"

describe("deriveHypervDiskPaths", () => {
  it("returns blank for a non-Hyper-V VM", () => {
    expect(deriveHypervDiskPaths({ hostType: "vmware", diskPaths: ["C:\\VMs\\a.vhdx"] })).toBe("")
  })

  it("returns blank for Hyper-V without disk paths", () => {
    expect(deriveHypervDiskPaths({ hostType: "hyperv" })).toBe("")
  })

  it("joins matching mount paths verbatim", () => {
    expect(deriveHypervDiskPaths({
      hostType: "hyperv",
      diskPaths: ["D:\\HYPERV\\a.vhdx", "D:\\HYPERV\\nested\\b.vhdx"],
      diskMountPaths: ["/mnt/hyperv/a.vhdx", "/mnt/hyperv/nested/b.vhdx"],
    })).toBe("/mnt/hyperv/a.vhdx\n/mnt/hyperv/nested/b.vhdx")
  })

  it("falls back to mounted basenames when mount paths are absent", () => {
    expect(deriveHypervDiskPaths({
      hostType: "hyperv",
      diskPaths: ["C:\\VMs\\a.vhdx", "D:\\VMs\\b.vhd"],
    })).toBe("/mnt/hyperv/a.vhdx\n/mnt/hyperv/b.vhd")
  })

  it("falls back when mount and disk path counts differ", () => {
    expect(deriveHypervDiskPaths({
      hostType: "hyperv",
      diskPaths: ["C:\\VMs\\a.vhdx", "C:\\VMs\\b.vhdx"],
      diskMountPaths: ["/mnt/hyperv/wrong/a.vhdx"],
    })).toBe("/mnt/hyperv/a.vhdx\n/mnt/hyperv/b.vhdx")
  })
})
