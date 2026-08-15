import { describe, it, expect } from "vitest"

import { vsanBlocksMigrationType, warmNeedsBlockStorage, isDowntimeBudgetValid, DOWNTIME_BUDGET_MIN_SEC, DOWNTIME_BUDGET_MAX_SEC } from "./migrationGuards"

describe("vsanBlocksMigrationType", () => {
  it("blocks the file-based types on a vSAN source", () => {
    expect(vsanBlocksMigrationType(true, "cold")).toBe(true)
    expect(vsanBlocksMigrationType(true, "live")).toBe(true)
    expect(vsanBlocksMigrationType(true, "sshfs_boot")).toBe(true)
  })

  it("lets warm through on a vSAN source", () => {
    // VDDK reads the disk API, not files, so this run is the one that works
    // without vCenter. Blocking it was the bug.
    expect(vsanBlocksMigrationType(true, "warm")).toBe(false)
  })

  it("blocks nothing when no disk sits on vSAN", () => {
    for (const type of ["cold", "live", "sshfs_boot", "warm"]) {
      expect(vsanBlocksMigrationType(false, type)).toBe(false)
    }
  })
})

describe("warmNeedsBlockStorage", () => {
  it("blocks warm on every file-based storage type", () => {
    // 2026-08-15: a warm run aimed at "local" (dir) died at planning time with
    // "requires a block-storage target", after the dialog had accepted it.
    for (const type of ["dir", "nfs", "cifs", "glusterfs", "cephfs", "btrfs"]) {
      expect(warmNeedsBlockStorage("warm", type)).toBe(true)
    }
  })

  it("lets warm through on block storage", () => {
    for (const type of ["lvm", "lvmthin", "zfspool", "rbd", "zfs"]) {
      expect(warmNeedsBlockStorage("warm", type)).toBe(false)
    }
  })

  it("leaves the other migration types alone on a file-based storage", () => {
    for (const migType of ["cold", "live", "sshfs_boot"]) {
      expect(warmNeedsBlockStorage(migType, "dir")).toBe(false)
    }
  })

  it("blocks nothing while the storage type is unknown", () => {
    // The storage list is still loading: the engine backstop still covers this,
    // and a button disabled on missing data reads as broken.
    expect(warmNeedsBlockStorage("warm", undefined)).toBe(false)
    expect(warmNeedsBlockStorage("warm", "")).toBe(false)
  })
})

describe("isDowntimeBudgetValid", () => {
  it("accepts an empty field, which means the pipeline default", () => {
    // Clearing the field must behave like never touching it, not like an error.
    expect(isDowntimeBudgetValid("")).toBe(true)
    expect(isDowntimeBudgetValid("   ")).toBe(true)
  })

  it("accepts the bounds the API accepts", () => {
    expect(isDowntimeBudgetValid(String(DOWNTIME_BUDGET_MIN_SEC))).toBe(true)
    expect(isDowntimeBudgetValid(String(DOWNTIME_BUDGET_MAX_SEC))).toBe(true)
    expect(isDowntimeBudgetValid("300")).toBe(true)
  })

  it("refuses what the API would refuse, before a job exists", () => {
    expect(isDowntimeBudgetValid(String(DOWNTIME_BUDGET_MIN_SEC - 1))).toBe(false)
    expect(isDowntimeBudgetValid(String(DOWNTIME_BUDGET_MAX_SEC + 1))).toBe(false)
    expect(isDowntimeBudgetValid("-30")).toBe(false)
  })

  it("refuses anything that is not a whole number of seconds", () => {
    for (const value of ["abc", "30.5", "3e2", "30s", "0x1e", "1 000"]) {
      expect(isDowntimeBudgetValid(value)).toBe(false)
    }
  })
})
