import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  hold: vi.fn(),
  resolve: vi.fn(),
  log: vi.fn(async (..._args: unknown[]) => {}),
  config: vi.fn(async (_id: string): Promise<Record<string, any>> => ({})),
  live: vi.fn(async (..._args: unknown[]) => {}),
}))

vi.mock("./hold-slot", () => ({ holdBetweenPasses: h.hold }))
vi.mock("./sync-interval-source", () => ({ resolveSyncIntervalSec: h.resolve }))
vi.mock("./job-control", () => ({ appendLog: h.log, readJobConfig: h.config, updateJobFields: h.live }))

import { awaitNextHoldPass, describeHoldInterval, type HoldPassStats } from "./hold-wait"

const MB = 1048576
const pass = (over: Partial<HoldPassStats> = {}): HoldPassStats => ({ durationSec: 8, deltaBytes: 100 * MB, throughputBytesPerSec: 50 * MB, budgetSec: 300, fixedDowntimeSec: 50, ...over })
/** The hold stand-in asks for the interval once, as the real one does before it sleeps. */
const holdReading = (result: "pass" | "cutover" = "pass") => async (_id: string, interval: () => Promise<number>) => { await interval(); return result }
const warnings = () => h.log.mock.calls.filter(c => c[2] === "warn")

beforeEach(() => {
  h.hold.mockReset().mockImplementation(holdReading())
  h.resolve.mockReset().mockResolvedValue(900)
  h.config.mockReset().mockResolvedValue({})
  h.log.mockClear()
  h.live.mockClear()
})
afterEach(() => { vi.useRealTimers() })

describe("awaitNextHoldPass", () => {
  it("sleeps the interval of the job's row and its source, then lets the next pass run", async () => {
    h.config.mockResolvedValue({ syncIntervalSec: 1800 })
    await expect(awaitNextHoldPass("j1", { syncIntervalSec: 60, sourceConnectionId: "src" })).resolves.toBe(true)

    expect(h.resolve).toHaveBeenCalledWith(1800, "src")
    expect(h.hold).toHaveBeenCalledWith("j1", expect.any(Function), expect.any(Object))
  })

  it("keeps the interval the job started with when its row cannot be read", async () => {
    h.config.mockRejectedValue(new Error("pool timeout"))
    await awaitNextHoldPass("j1", { syncIntervalSec: 600, sourceConnectionId: "src" })

    expect(h.resolve).toHaveBeenCalledWith(600, "src")
  })

  it("hands the hold a reader, so a change of interval reaches a job that already sleeps, and logs the change", async () => {
    h.hold.mockImplementation(async (_id: string, interval: () => Promise<number>) => {
      expect(await interval()).toBe(900)
      h.resolve.mockResolvedValue(300)
      expect(await interval()).toBe(300)
      return "pass"
    })
    await awaitNextHoldPass("j1", { sourceConnectionId: "src" })

    expect(h.log).toHaveBeenCalledWith("j1", "Interval between two syncs changed from 15 min to 5 min.", "info")
  })

  it("answers false when the operator asked for the cutover", async () => {
    h.hold.mockImplementation(holdReading("cutover"))
    await expect(awaitNextHoldPass("j1", { sourceConnectionId: "src" })).resolves.toBe(false)
  })

  it("writes in the job log why no sync runs when the limits are full", async () => {
    h.hold.mockImplementation(async (_id: string, _interval: unknown, opts: any) => { await opts.onWaitForSlot(); return "pass" })
    await awaitNextHoldPass("j1", { sourceConnectionId: "src" })

    expect(h.log).toHaveBeenCalledWith("j1", "Next sync is waiting for a free migration slot: the limits of the target cluster, of its node or of the source host are reached, or VMs of a bulk migration are still queued.", "info")
  })

  it("warns once when a sync lasted longer than the interval between two syncs", async () => {
    h.resolve.mockResolvedValue(300)
    await awaitNextHoldPass("slow", { sourceConnectionId: "src" }, pass({ durationSec: 720 }))
    await awaitNextHoldPass("slow", { sourceConnectionId: "src" }, pass({ durationSec: 800 }))

    expect(warnings()).toEqual([["slow", "The last sync took 12 min, longer than the 5 min interval between two syncs: the source spends more time taking and merging snapshots than resting. A longer interval would relieve it.", "warn"]])
  })

  it("spells the seconds of a sync barely longer than the interval, so the two durations never read the same", async () => {
    // Seen at the lab on a busy XCP-ng VM: 61 s against 60 s read "took 1 min, longer than the 1 min interval".
    h.resolve.mockResolvedValue(60)
    await awaitNextHoldPass("barely", { sourceConnectionId: "src" }, pass({ durationSec: 61.4 }))

    expect(warnings()[0][1]).toContain("The last sync took 1 min 1 s, longer than the 1 min interval")
  })

  it("stays silent when the sync fits in the interval, or when nothing was measured", async () => {
    h.resolve.mockResolvedValue(300)
    await awaitNextHoldPass("fast", { sourceConnectionId: "src" }, pass({ durationSec: 300 }))
    await awaitNextHoldPass("fast", { sourceConnectionId: "src" })

    expect(warnings()).toEqual([])
  })

  it("warns again for a job whose earlier hold ended", async () => {
    h.resolve.mockResolvedValue(60)
    h.hold.mockImplementation(holdReading("cutover"))
    await awaitNextHoldPass("again", { sourceConnectionId: "src" }, pass({ durationSec: 90 }))
    await awaitNextHoldPass("again", { sourceConnectionId: "src" }, pass({ durationSec: 90 }))

    expect(warnings()).toHaveLength(2)
  })

  it("lets a cancellation through", async () => {
    h.hold.mockRejectedValue(new Error("Migration cancelled"))
    await expect(awaitNextHoldPass("j1", { sourceConnectionId: "src" })).rejects.toThrow("Migration cancelled")
  })
})

describe("the interval the syncs suggest", () => {
  it("stores nothing after the first sync of a hold, which only sets the clock", async () => {
    await awaitNextHoldPass("s1", { sourceConnectionId: "src" }, pass())
    expect(h.live).not.toHaveBeenCalled()
  })

  it("stores a suggestion from the second sync on, from what changed since the previous snapshot", async () => {
    vi.useFakeTimers({ now: 1_000_000_000 })
    await awaitNextHoldPass("s2", { sourceConnectionId: "src" }, pass())
    vi.setSystemTime(1_000_000_000 + 300_000)
    // 100 MB over 5 min is nothing for the budget: four times the 5 min observed, on the 15 min step.
    await awaitNextHoldPass("s2", { sourceConnectionId: "src" }, pass())

    // 100 MB over 300 s against 50 MB/s: 2 s of copy in the 8 s sync, 6 s of
    // snapshot handling; at the 15 min in force a cutover costs the fixed 50 s.
    expect(h.live).toHaveBeenCalledWith("s2", {
      suggestedSyncIntervalSec: 900,
      syncMeasure: { changeRateBytesPerSec: (100 * MB) / 300, throughputBytesPerSec: 50 * MB, passOverheadSec: 6, fixedDowntimeSec: 50, targetDowntimeSec: 300 },
      projectedDowntimeSec: 50,
    })
  })

  it("keeps the busiest of the last syncs in mind", async () => {
    vi.useFakeTimers({ now: 2_000_000_000 })
    await awaitNextHoldPass("s3", { sourceConnectionId: "src" }, pass())
    vi.setSystemTime(2_000_000_000 + 300_000)
    await awaitNextHoldPass("s3", { sourceConnectionId: "src" }, pass({ deltaBytes: 20480 * MB }))
    vi.setSystemTime(2_000_000_000 + 600_000)
    await awaitNextHoldPass("s3", { sourceConnectionId: "src" }, pass({ deltaBytes: 0 }))

    expect(h.live).toHaveBeenLastCalledWith("s3", expect.objectContaining({
      suggestedSyncIntervalSec: 60,
      syncMeasure: expect.objectContaining({ changeRateBytesPerSec: (20480 * MB) / 300 }),
    }))
  })

  it("does not fail the wait when the suggestion cannot be stored", async () => {
    vi.useFakeTimers({ now: 3_000_000_000 })
    h.live.mockRejectedValue(new Error("pool timeout"))
    await awaitNextHoldPass("s4", { sourceConnectionId: "src" }, pass())
    vi.setSystemTime(3_000_000_000 + 300_000)
    await expect(awaitNextHoldPass("s4", { sourceConnectionId: "src" }, pass())).resolves.toBe(true)
    h.live.mockReset()
  })
})

describe("describeHoldInterval", () => {
  it("names the interval the job starts its hold with", async () => {
    await expect(describeHoldInterval({ syncIntervalSec: 1800, sourceConnectionId: "src" })).resolves.toBe("15 min")
    h.resolve.mockResolvedValue(7200)
    await expect(describeHoldInterval({ sourceConnectionId: "src" })).resolves.toBe("2 h")
  })
})
