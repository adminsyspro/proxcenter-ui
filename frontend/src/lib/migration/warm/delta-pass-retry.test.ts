import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  registerJob, unregisterJob, runDeltaPassWithRetry, requestWarmCutover, cancelWarmMigrationJob,
} from "./job-control"

/**
 * #1028: a 2.4 TB warm run held for manual cutover replicated for 20 hours,
 * then one SSH call to the node missed its 30 s budget on pass 102 and the
 * whole job failed. A pre-cutover pass that fails must be retried from the
 * last good baseline instead.
 */

const JOB = "job-delta-retry-1"

let row: Record<string, any>

const prisma = {
  migrationJob: {
    findUnique: vi.fn(async () => row),
    update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return row }),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
}

const logs = () => ((row.logs ?? []) as { msg: string; level: string }[])

beforeEach(async () => {
  vi.useFakeTimers()
  row = { status: "delta_sync", logs: [], progress: 90, cutoverRequestedAt: null, forcePowerOffRequestedAt: null, rootChoice: null }
  await registerJob(JOB, prisma)
})

afterEach(() => {
  unregisterJob(JOB)
  vi.useRealTimers()
})

describe("runDeltaPassWithRetry", () => {
  it("returns the pass result without logging when the first attempt succeeds", async () => {
    const run = vi.fn(async () => 42)
    await expect(runDeltaPassWithRetry(JOB, "Delta pass 1", run)).resolves.toBe(42)
    expect(run).toHaveBeenCalledTimes(1)
    expect(logs()).toHaveLength(0)
  })

  it("retries a transient failure after the delay and logs it as a warning", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("failed to launch nbdkit-vddk: orchestrator SSH timeout (30s)"))
      .mockResolvedValueOnce(7)
    const p = runDeltaPassWithRetry(JOB, "Delta pass 102", run, { delayMs: 5000 })
    await vi.advanceTimersByTimeAsync(4000)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(p).resolves.toBe(7)
    expect(run).toHaveBeenCalledTimes(2)
    expect(logs()).toHaveLength(1)
    expect(logs()[0].level).toBe("warn")
    expect(logs()[0].msg).toContain("Delta pass 102 failed (attempt 1 of 5)")
    expect(logs()[0].msg).toContain("orchestrator SSH timeout (30s)")
  })

  it("gives up after the last attempt with the last error in the message", async () => {
    const run = vi.fn(async () => { throw new Error("node unreachable") })
    const p = runDeltaPassWithRetry(JOB, "Delta pass 3", run, { maxAttempts: 3, delayMs: 1000 })
    const settled = expect(p).rejects.toThrow("Delta pass 3 failed 3 times in a row, last error: node unreachable")
    await vi.advanceTimersByTimeAsync(5000)
    await settled
    expect(run).toHaveBeenCalledTimes(3)
    expect(logs()).toHaveLength(2)
  })

  it("does not retry a cancelled job", async () => {
    const run = vi.fn(async () => { cancelWarmMigrationJob(JOB); throw new Error("Migration cancelled") })
    await expect(runDeltaPassWithRetry(JOB, "Delta pass 1", run)).rejects.toThrow("Migration cancelled")
    expect(run).toHaveBeenCalledTimes(1)
    expect(logs()).toHaveLength(0)
  })

  it("returns null when the operator asks for cutover during the retry wait", async () => {
    const run = vi.fn(async () => { throw new Error("orchestrator SSH timeout (30s)") })
    const p = runDeltaPassWithRetry(JOB, "Delta pass 9", run, { delayMs: 60_000 })
    await vi.advanceTimersByTimeAsync(2000)
    requestWarmCutover(JOB)
    await vi.advanceTimersByTimeAsync(1500)
    await expect(p).resolves.toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
  })
})
