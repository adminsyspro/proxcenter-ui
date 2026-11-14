import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { registerJob, unregisterJob, isCutoverRequested, isCancelled, isForcePowerOffRequested, updateJob, updateJobFields } from "./job-control"
import { OPERATOR_SIGNAL_POLL_MS } from "@/lib/migration/operator-signals"

/**
 * The bug these cover: an operator clicks "Cutover now", the route sets the
 * flag in its own copy of this module, and the running pipeline, holding a
 * different copy, polls a set that stays empty forever. Measured on a warm run
 * where the route was compiled twelve minutes after the pipeline started. The
 * signal now travels through the job row, so what the route wrote is what this
 * module reads, whichever instance either of them lives in.
 */

const JOB = "job-mirror-1"

let row: Record<string, any>

const prisma = {
  migrationJob: {
    findUnique: vi.fn(async () => row),
    updateMany: vi.fn(async ({ data }: any) => {
      Object.assign(row, data)

      return { count: 1 }
    }),
  },
}

beforeEach(() => {
  vi.useFakeTimers()
  row = { status: "delta_sync", cutoverRequestedAt: null, forcePowerOffRequestedAt: null, rootChoice: null }
  prisma.migrationJob.findUnique.mockClear()
  prisma.migrationJob.updateMany.mockClear()
})

afterEach(() => {
  unregisterJob(JOB)
  vi.useRealTimers()
})

describe("warm job control, signals recorded on the row", () => {
  it("picks up a cutover the route recorded, not just one signalled in-process", async () => {
    await registerJob(JOB, prisma)
    expect(isCutoverRequested(JOB)).toBe(false)

    row.cutoverRequestedAt = new Date()
    await vi.advanceTimersByTimeAsync(OPERATOR_SIGNAL_POLL_MS)
    expect(isCutoverRequested(JOB)).toBe(true)
  })

  it("picks up a hard power off the same way", async () => {
    await registerJob(JOB, prisma)
    row.forcePowerOffRequestedAt = new Date()
    await vi.advanceTimersByTimeAsync(OPERATOR_SIGNAL_POLL_MS)
    expect(isForcePowerOffRequested(JOB)).toBe(true)
  })

  it("treats a cancelled row as a cancellation, which is how the cancel route signals", async () => {
    await registerJob(JOB, prisma)
    row.status = "cancelled"
    await vi.advanceTimersByTimeAsync(OPERATOR_SIGNAL_POLL_MS)
    expect(isCancelled(JOB)).toBe(true)
  })

  it("ignores a decision that was recorded before the run started", async () => {
    // Whatever put it there, a run must not inherit it: an old "cutover now"
    // would fire on the first delta pass, on a copy nobody asked to switch.
    row.cutoverRequestedAt = new Date("2026-01-01T00:00:00Z")
    await registerJob(JOB, prisma)
    await vi.advanceTimersByTimeAsync(OPERATOR_SIGNAL_POLL_MS)
    expect(isCutoverRequested(JOB)).toBe(false)
  })

  it("stops reading the row once the run has ended", async () => {
    await registerJob(JOB, prisma)
    unregisterJob(JOB)
    const reads = prisma.migrationJob.findUnique.mock.calls.length

    row.cutoverRequestedAt = new Date()
    await vi.advanceTimersByTimeAsync(OPERATOR_SIGNAL_POLL_MS * 3)
    expect(prisma.migrationJob.findUnique.mock.calls.length).toBe(reads)
    expect(isCutoverRequested(JOB)).toBe(false)
  })
})

describe("updateJobFields", () => {
  it("writes the fields of a running job without touching its status or its step", async () => {
    await registerJob(JOB, prisma)
    prisma.migrationJob.updateMany.mockClear()

    await updateJobFields(JOB, { suggestedSyncIntervalSec: 900 })

    expect(prisma.migrationJob.updateMany).toHaveBeenCalledWith({
      where: { id: JOB, status: { notIn: ["completed", "failed", "cancelled"] } },
      data: { suggestedSyncIntervalSec: 900 },
    })
  })
})

describe("updateJob", () => {
  // Seen at the lab (14/11, twice): a cancel sent while a sync was running was
  // written to the row, then the sync's own progress write put "delta_sync"
  // back before the pipeline had read the cancel, and the migration kept
  // syncing behind a task the operator believed stopped.
  const guarded = () => {
    const calls: any[] = []
    const db = {
      migrationJob: {
        findUnique: vi.fn(async () => row),
        update: vi.fn(async ({ data }: any) => { calls.push("update"); Object.assign(row, data); return row }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          calls.push("updateMany")
          if (where.status?.not === row.status || where.status?.notIn?.includes(row.status)) return { count: 0 }
          Object.assign(row, data)
          return { count: 1 }
        }),
      },
    }
    return { db, calls }
  }

  it("does not bring back a migration cancelled while it was working", async () => {
    const { db } = guarded()
    await registerJob(JOB, db)
    row.status = "cancelled"
    row.currentStep = "cancelled"

    await updateJob(JOB, "delta_sync", { currentStep: "delta_3", progress: 90 })

    expect(row).toMatchObject({ status: "cancelled", currentStep: "cancelled" })
    expect(row.progress).toBeUndefined()
  })

  it("still moves a running migration from one step to the next", async () => {
    const { db } = guarded()
    await registerJob(JOB, db)

    await updateJob(JOB, "cutover", { progress: 95 })

    expect(row).toMatchObject({ status: "cutover", currentStep: "cutover", progress: 95 })
  })

  it("still writes how the run ended, whatever the row says", async () => {
    const { db } = guarded()
    await registerJob(JOB, db)
    row.status = "cancelled"

    await updateJob(JOB, "completed")

    expect(row.status).toBe("completed")
    expect(row.completedAt).toBeInstanceOf(Date)
  })
})
