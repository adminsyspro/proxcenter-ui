import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  readOperatorSignals,
  clearOperatorSignals,
  startOperatorSignalWatch,
  stopOperatorSignalWatch,
  __watchedJobsForTest,
  OPERATOR_SIGNAL_POLL_MS,
} from "./operator-signals"

const row = (overrides: Record<string, unknown> = {}) => ({
  status: "delta_sync",
  cutoverRequestedAt: null,
  forcePowerOffRequestedAt: null,
  rootChoice: null,
  ...overrides,
})

const prismaWith = (findUnique: any) => ({
  migrationJob: { findUnique, updateMany: vi.fn(async () => ({ count: 1 })) },
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  stopOperatorSignalWatch("j1")
  vi.useRealTimers()
})

describe("readOperatorSignals", () => {
  it("reads each decision off the row", async () => {
    const prisma = prismaWith(vi.fn(async () => row({
      status: "converting_disks",
      cutoverRequestedAt: new Date(),
      forcePowerOffRequestedAt: new Date(),
      rootChoice: "/dev/sda1",
    })))
    expect(await readOperatorSignals(prisma, "j1")).toEqual({
      cancelled: false,
      cutover: true,
      forcePowerOff: true,
      rootChoice: "/dev/sda1",
    })
  })

  it("reports a cancelled row as cancelled, since the cancel route has no column of its own", async () => {
    const prisma = prismaWith(vi.fn(async () => row({ status: "cancelled" })))
    expect(await readOperatorSignals(prisma, "j1")).toMatchObject({ cancelled: true, cutover: false })
  })

  it("returns null when the row is gone", async () => {
    const prisma = prismaWith(vi.fn(async () => null))
    expect(await readOperatorSignals(prisma, "j1")).toBeNull()
  })

  it("treats an empty root choice as no choice", async () => {
    const prisma = prismaWith(vi.fn(async () => row({ rootChoice: "" })))
    expect((await readOperatorSignals(prisma, "j1"))?.rootChoice).toBeNull()
  })
})

describe("clearOperatorSignals", () => {
  it("nulls the three columns with updateMany, so a vanished row does not throw", async () => {
    const prisma = prismaWith(vi.fn())
    await clearOperatorSignals(prisma, "j1")
    expect(prisma.migrationJob.updateMany).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: { cutoverRequestedAt: null, forcePowerOffRequestedAt: null, rootChoice: null },
    })
  })
})

describe("startOperatorSignalWatch", () => {
  it("clears anything recorded before the run, before reading the row", async () => {
    // A run must never inherit a decision it did not see taken: a "cutover
    // now" left on the row would fire on the first delta pass.
    const order: string[] = []
    const findUnique = vi.fn(async () => { order.push("read"); return row() })
    const prisma = {
      migrationJob: {
        findUnique,
        updateMany: vi.fn(async () => { order.push("clear"); return { count: 1 } }),
      },
    }
    await startOperatorSignalWatch(prisma, "j1", () => {})
    expect(order[0]).toBe("clear")
    expect(order).toContain("read")
  })

  it("mirrors what the row says on every tick", async () => {
    let current = row()
    const prisma = prismaWith(vi.fn(async () => current))
    const seen: any[] = []
    await startOperatorSignalWatch(prisma, "j1", s => seen.push(s))
    expect(seen.at(-1)).toMatchObject({ cutover: false })

    current = row({ cutoverRequestedAt: new Date() })
    await vi.advanceTimersByTimeAsync(OPERATOR_SIGNAL_POLL_MS)
    expect(seen.at(-1)).toMatchObject({ cutover: true })
  })

  it("stops reading once the run has ended", async () => {
    const findUnique = vi.fn(async () => row())
    const prisma = prismaWith(findUnique)
    await startOperatorSignalWatch(prisma, "j1", () => {})
    const reads = findUnique.mock.calls.length
    stopOperatorSignalWatch("j1")
    await vi.advanceTimersByTimeAsync(OPERATOR_SIGNAL_POLL_MS * 3)
    expect(findUnique.mock.calls.length).toBe(reads)
    expect(__watchedJobsForTest()).not.toContain("j1")
  })

  it("keeps polling after a failed read, since the row keeps the decision", async () => {
    const findUnique = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue(row({ cutoverRequestedAt: new Date() }))
    const prisma = prismaWith(findUnique)
    const seen: any[] = []
    await startOperatorSignalWatch(prisma, "j1", s => seen.push(s))
    expect(seen).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(OPERATOR_SIGNAL_POLL_MS)
    expect(seen.at(-1)).toMatchObject({ cutover: true })
  })

  it("replaces an earlier watch for the same job instead of stacking one", async () => {
    const prisma = prismaWith(vi.fn(async () => row()))
    await startOperatorSignalWatch(prisma, "j1", () => {})
    await startOperatorSignalWatch(prisma, "j1", () => {})
    expect(__watchedJobsForTest().filter(id => id === "j1")).toHaveLength(1)
  })
})
