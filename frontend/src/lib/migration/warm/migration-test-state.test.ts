import { describe, it, expect } from "vitest"

import {
  canStartMigrationTest,
  isTestActive,
  MIGRATION_TEST_MAX_SEC_CHOICES,
  MIGRATION_TEST_MAX_SEC_DEFAULT,
  parseTestRequest,
  readTestState,
} from "./migration-test-state"

describe("parseTestRequest", () => {
  it("accepts a storage and a duration, with no network by default", () => {
    expect(parseTestRequest({ storage: "Dir-Images", maxSec: 14400 })).toEqual({
      ok: true,
      request: { storage: "Dir-Images", bridge: null, vlanTag: null, maxSec: 14400 },
    })
  })

  it("keeps a bridge and its VLAN tag", () => {
    expect(parseTestRequest({ storage: "nfs1", bridge: "vmbr9", vlanTag: 30, maxSec: 3600 })).toEqual({
      ok: true,
      request: { storage: "nfs1", bridge: "vmbr9", vlanTag: 30, maxSec: 3600 },
    })
  })

  it("refuses a duration outside the offered choices", () => {
    expect(parseTestRequest({ storage: "Dir-Images", maxSec: 999 })).toEqual({ ok: false, error: "maxSec must be one of 3600, 7200, 14400, 28800, 86400" })
  })

  it("refuses a VLAN tag out of range", () => {
    expect(parseTestRequest({ storage: "Dir-Images", bridge: "vmbr0", vlanTag: 4095, maxSec: 3600 })).toEqual({ ok: false, error: "vlanTag must be between 1 and 4094" })
  })

  it("refuses a VLAN tag without a bridge", () => {
    expect(parseTestRequest({ storage: "Dir-Images", vlanTag: 30, maxSec: 3600 })).toEqual({ ok: false, error: "vlanTag needs a bridge" })
  })

  it("requires a storage", () => {
    expect(parseTestRequest({ storage: " ", maxSec: 3600 })).toEqual({ ok: false, error: "storage is required" })
    expect(parseTestRequest(null)).toEqual({ ok: false, error: "storage is required" })
  })

  it("refuses names that are not a PVE storage or bridge id", () => {
    expect(parseTestRequest({ storage: "a;rm -rf /", maxSec: 3600 })).toEqual({ ok: false, error: "storage is not a valid storage id" })
    expect(parseTestRequest({ storage: "local", bridge: "vmbr0 x", maxSec: 3600 })).toEqual({ ok: false, error: "bridge is not a valid bridge name" })
  })

  it("offers 4 h by default among its choices", () => {
    expect(MIGRATION_TEST_MAX_SEC_CHOICES).toEqual([3600, 7200, 14400, 28800, 86400])
    expect(MIGRATION_TEST_MAX_SEC_DEFAULT).toBe(14400)
  })
})

describe("readTestState", () => {
  it("reads a known phase and drops anything else", () => {
    expect(readTestState({ phase: "running", testVmid: 9001 })).toEqual({ phase: "running", testVmid: 9001 })
    expect(readTestState({ phase: "bogus" })).toBeNull()
    expect(readTestState(null)).toBeNull()
    expect(readTestState("running")).toBeNull()
  })
})

describe("isTestActive", () => {
  it("is true while a request waits or a test runs, false once it ended or failed", () => {
    expect(isTestActive({ testRequest: { storage: "x", maxSec: 3600 } })).toBe(true)
    expect(isTestActive({ testState: { phase: "running" } })).toBe(true)
    expect(isTestActive({ testState: { phase: "stopping" } })).toBe(true)
    expect(isTestActive({ testState: { phase: "failed" } })).toBe(false)
    expect(isTestActive({ testState: { phase: "ended" } })).toBe(false)
    expect(isTestActive({})).toBe(false)
  })
})

describe("canStartMigrationTest", () => {
  const waiting = { status: "delta_sync", config: { cutoverMode: "manual", migrationType: "warm" } }

  it("allows a waiting manual-cutover warm migration", () => {
    expect(canStartMigrationTest(waiting)).toBe(true)
    expect(canStartMigrationTest({ ...waiting, testState: { phase: "ended" } })).toBe(true)
  })

  it("refuses once the cutover was asked, outside a manual hold, or while a test runs", () => {
    expect(canStartMigrationTest({ ...waiting, cutoverRequestedAt: new Date().toISOString() })).toBe(false)
    expect(canStartMigrationTest({ ...waiting, config: { cutoverMode: "auto", migrationType: "warm" } })).toBe(false)
    expect(canStartMigrationTest({ ...waiting, config: { cutoverMode: "manual", migrationType: "cold" } })).toBe(false)
    expect(canStartMigrationTest({ ...waiting, status: "full_copy" })).toBe(false)
    expect(canStartMigrationTest({ ...waiting, testState: { phase: "running" } })).toBe(false)
  })
})
