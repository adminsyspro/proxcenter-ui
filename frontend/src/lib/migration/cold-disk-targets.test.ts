import { describe, it, expect } from "vitest"

import {
  coldStorageTarget, coldStorages, localVolumeKinds, describeStorageSpace, storageSpaceShortfall, SPACE_MARGIN,
} from "./cold-disk-targets"
import { planDiskTargets } from "./target-overrides"

const GIB = 1073741824

describe("coldStorageTarget", () => {
  it("imports as qcow2 into <path>/images/<vmid> with discard on a file-based storage", () => {
    expect(coldStorageTarget("nfs-slow", { type: "nfs", path: "/mnt/pve/nfs-slow" }, 120)).toEqual({
      storage: "nfs-slow", type: "nfs", isFileBased: true, importFormat: "qcow2",
      imagesDir: "/mnt/pve/nfs-slow/images/120", driveOpts: ",discard=on",
    })
  })

  it("allocates raw, with no temp dir and no discard, on a block storage", () => {
    expect(coldStorageTarget("local-lvm", { type: "lvmthin" }, 120)).toEqual({
      storage: "local-lvm", type: "lvmthin", isFileBased: false, importFormat: "raw", imagesDir: "", driveOpts: "",
    })
  })

  it("falls back to a dir storage under /var/lib/vz when the config is missing", () => {
    // The pre-lot-2 defaults, kept so a storage whose config cannot be read behaves as before.
    const t = coldStorageTarget("local", null, 7)
    expect(t.type).toBe("dir")
    expect(t.isFileBased).toBe(true)
    expect(t.imagesDir).toBe("/var/lib/vz/images/7")
  })
})

describe("coldStorages", () => {
  const disks = ["a", "b", "c"]

  it("is just the job default when no disk is mapped", () => {
    expect(coldStorages("local-lvm", planDiskTargets(disks, undefined, "local-lvm"))).toEqual(["local-lvm"])
  })

  it("keeps the default first even when no kept disk lands on it, then the others in first-use order", () => {
    const plan = planDiskTargets(disks, [
      { index: 0, targetStorage: "fast" }, { index: 1, targetStorage: "slow" }, { index: 2, targetStorage: "fast" },
    ], "local-lvm")
    expect(coldStorages("local-lvm", plan)).toEqual(["local-lvm", "fast", "slow"])
  })

  it("ignores the storage of an excluded disk", () => {
    const plan = planDiskTargets(disks, [{ index: 2, exclude: true }, { index: 1, targetStorage: "slow" }], "local-lvm")
    expect(coldStorages("local-lvm", plan)).toEqual(["local-lvm", "slow"])
  })
})

describe("localVolumeKinds", () => {
  const file = coldStorageTarget("nfs", { type: "nfs", path: "/mnt/nfs" }, 1)
  const block = coldStorageTarget("lvm", { type: "lvm" }, 1)

  it("names the single kind when every disk agrees", () => {
    expect(localVolumeKinds([block, block])).toBe("block")
    expect(localVolumeKinds([file])).toBe("file-based")
  })

  it("names both kinds, in disk order, for a mixed plan", () => {
    expect(localVolumeKinds([block, file])).toBe("block and file-based")
    expect(localVolumeKinds([file, block, file])).toBe("file-based and block")
  })

  it("says block for an empty plan", () => {
    expect(localVolumeKinds([])).toBe("block")
  })
})

describe("free-space check per storage", () => {
  it("formats the log line in GB with one decimal", () => {
    expect(describeStorageSpace("ISO", 55.5 * GIB, 20 * GIB)).toBe('Target storage "ISO": 55.5 GB free, need 20.0 GB')
  })

  it("accepts a storage whose free space covers the need with the margin", () => {
    expect(SPACE_MARGIN).toBe(1.1)
    expect(storageSpaceShortfall("ISO", 22 * GIB, 20 * GIB)).toBeNull()
    expect(storageSpaceShortfall("ISO", 0, 0)).toBeNull()
  })

  it("refuses, naming the storage, when the margin is not met", () => {
    expect(storageSpaceShortfall("ISO", 21 * GIB, 20 * GIB)).toBe('Insufficient disk space on "ISO": 21.0 GB free, need 20.0 GB')
  })
})

describe("coldStorageTarget images directory", () => {
  it("refuses a storage path that is not a plain absolute path, since it lands in node shell commands", () => {
    expect(() => coldStorageTarget("odd", { type: "dir", path: "/mnt/pve/odd name" }, 120)).toThrow(/Invalid absolute path/)
    expect(() => coldStorageTarget("odd", { type: "dir", path: "relative/path" }, 120)).toThrow(/Invalid absolute path/)
    expect(() => coldStorageTarget("odd", { type: "dir", path: "/mnt/pve/$(id)" }, 120)).toThrow(/Invalid absolute path/)
    expect(coldStorageTarget("ok", { type: "dir", path: "/mnt/pve/ISO/dir-images" }, 120).imagesDir).toBe("/mnt/pve/ISO/dir-images/images/120")
    // A block storage has no images directory and no path to judge.
    expect(coldStorageTarget("lvm", { type: "lvm", path: "/not used" }, 120).imagesDir).toBe("")
  })
})
