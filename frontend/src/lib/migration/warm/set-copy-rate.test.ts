import { describe, expect, it, vi } from "vitest"

import { canSetBatchCopyRate, canSetCopyRate, readRequestedCopyRate, setJobCopyRate } from "./set-copy-rate"

describe("readRequestedCopyRate", () => {
  it("reads a cap, and null as 'no cap'", () => {
    expect(readRequestedCopyRate({ copyRateLimit: { mbps: 40 } })).toEqual({ mbps: 40 })
    expect(readRequestedCopyRate({ copyRateLimit: null })).toBeNull()
  })

  it("answers undefined for a missing or invalid value", () => {
    expect(readRequestedCopyRate({})).toBeUndefined()
    expect(readRequestedCopyRate(null)).toBeUndefined()
    expect(readRequestedCopyRate({ copyRateLimit: { mbps: -5 } })).toBeUndefined()
  })
})

describe("canSetCopyRate", () => {
  const job = (over: any = {}) => ({ status: "full_copy", batchId: null, config: { migrationType: "warm" }, ...over })

  it("accepts a warm migration that is not over", () => {
    expect(canSetCopyRate(job())).toBe(true)
    expect(canSetCopyRate(job({ status: "queued" }))).toBe(true)
  })

  it("refuses a cold or finished migration", () => {
    expect(canSetCopyRate(job({ config: { migrationType: "cold" } }))).toBe(false)
    expect(canSetCopyRate(job({ status: "completed" }))).toBe(false)
    expect(canSetCopyRate(job({ status: "cancelled" }))).toBe(false)
  })
})

describe("canSetBatchCopyRate", () => {
  it("accepts a running or paused batch only", () => {
    expect(canSetBatchCopyRate({ status: "running" })).toBe(true)
    expect(canSetBatchCopyRate({ status: "paused" })).toBe(true)
    expect(canSetBatchCopyRate({ status: "completed" })).toBe(false)
    expect(canSetBatchCopyRate({ status: "cancelled" })).toBe(false)
  })
})

describe("setJobCopyRate", () => {
  it("writes the cap into the job's config, and drops it with null", async () => {
    const update = vi.fn(async () => ({}))
    const job = { id: "j1", config: { migrationType: "warm", copyRateLimit: { mbps: 10 }, syncIntervalSec: 60 } }
    await setJobCopyRate({ migrationJob: { update } }, job, { mbps: 40 })
    expect(update).toHaveBeenLastCalledWith({ where: { id: "j1" }, data: { config: { migrationType: "warm", syncIntervalSec: 60, copyRateLimit: { mbps: 40 } } } })
    await setJobCopyRate({ migrationJob: { update } }, job, null)
    expect(update).toHaveBeenLastCalledWith({ where: { id: "j1" }, data: { config: { migrationType: "warm", syncIntervalSec: 60 } } })
  })
})
