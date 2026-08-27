import { describe, expect, it } from "vitest"

import { HYPERV_MOUNT_ROOT, hypervDiskBasename, hypervDiskMountPath } from "./diskPaths"

const disk = "D:\\HYPERV\\2025-test\\2025-test\\Virtual Hard Disks\\2025-test.vhdx"
const mounted = "/mnt/hyperv/2025-test/2025-test/Virtual Hard Disks/2025-test.vhdx"

describe("hypervDiskMountPath", () => {
  it.each([
    [disk, "D:\\HYPERV", mounted],
    [disk, "d:\\hyperv", mounted],
    [disk, "D:\\HYPERV\\", mounted],
    ["D:/HYPERV/vm/Virtual Hard Disks/vm.vhdx", "D:/HYPERV", "/mnt/hyperv/vm/Virtual Hard Disks/vm.vhdx"],
  ])("maps %s relative to %s", (windowsPath, sharePath, expected) => {
    expect(hypervDiskMountPath(windowsPath, sharePath)).toBe(expected)
  })

  it.each([null, undefined, ""])("uses the basename when the share is %j", sharePath => {
    expect(hypervDiskMountPath(disk, sharePath)).toBe(`${HYPERV_MOUNT_ROOT}/2025-test.vhdx`)
  })

  it("uses the basename for a disk outside the share", () => {
    expect(hypervDiskMountPath("E:\\other\\x.vhdx", "D:\\HYPERV")).toBe("/mnt/hyperv/x.vhdx")
  })

  it("uses the basename when the disk path equals the share path", () => {
    expect(hypervDiskMountPath("D:\\HYPERV", "D:\\HYPERV")).toBe("/mnt/hyperv/HYPERV")
  })
})

describe("hypervDiskBasename", () => {
  it.each([
    ["D:\\VMs\\disk.vhdx", "disk.vhdx"],
    ["/mnt/hyperv/vm/disk.vhd", "disk.vhd"],
  ])("extracts the filename from %s", (path, expected) => {
    expect(hypervDiskBasename(path)).toBe(expected)
  })
})
