import { describe, expect, it } from "vitest"

import { deriveHypervDiskPaths, hypervDiskPathsFromScan } from "./useMigrationOptions"

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

describe("hypervDiskPathsFromScan (#1255)", () => {
  const scanned = ["/mnt/hyperv/OtherVM/other-data.vhdx", "/mnt/hyperv/TestVM01/disk01.vhdx"]

  it("leaves the disks the host reported alone, whatever the share scan found", () => {
    expect(hypervDiskPathsFromScan({ hostType: "hyperv", diskPaths: ["D:\\HV\\TestVM01\\disk01.vhdx"] }, scanned)).toBeNull()
  })

  it("fills the free-text field when the host reported no disk", () => {
    expect(hypervDiskPathsFromScan({ hostType: "hyperv", diskPaths: [] }, scanned)).toBe(scanned.join("\n"))
    expect(hypervDiskPathsFromScan({ hostType: "hyperv" }, scanned)).toBe(scanned.join("\n"))
  })

  it("does nothing when the scan found nothing", () => {
    expect(hypervDiskPathsFromScan({ hostType: "hyperv" }, [])).toBeNull()
  })
})
