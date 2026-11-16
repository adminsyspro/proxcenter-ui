import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn(async () => ({ success: true, output: "" })) }
})
import { executeSSH } from "@/lib/ssh/exec"

import { openCopyRateGovernor, resolveCopyRateShare, startCopyRateGovernor, type GovernorDb } from "./copy-rate-governor"

type JobRow = { id: string; batchId: string | null; sourceConnectionId: string; config: any; copyActiveAt: Date | null }

const NOW = new Date("2026-11-16T10:00:00Z")

/** In-memory stand-in of the three tables the governor reads, with the filters it uses. */
function fakeDb(init: { jobs: JobRow[]; batches?: Record<string, any>; perHost?: Record<string, number | null> }) {
  const jobs = new Map(init.jobs.map(j => [j.id, { ...j }]))
  const batches = { ...(init.batches ?? {}) }
  const perHost = { ...(init.perHost ?? {}) }
  const db: GovernorDb = {
    migrationJob: {
      findUnique: async ({ where }: any) => jobs.get(where.id) ?? null,
      findMany: async ({ where }: any) => [...jobs.values()].filter(j =>
        j.copyActiveAt != null && j.copyActiveAt >= where.copyActiveAt.gte
        && where.OR.some((c: any) => (c.batchId !== undefined && c.batchId === j.batchId) || (c.sourceConnectionId !== undefined && c.sourceConnectionId === j.sourceConnectionId))),
      update: async ({ where, data }: any) => { Object.assign(jobs.get(where.id)!, data); return {} },
    },
    migrationBatch: { findUnique: async ({ where }: any) => (where.id in batches ? { copyRateLimit: batches[where.id] } : null) },
    connection: { findUnique: async ({ where }: any) => ({ migrationCopyRateLimitPerHostMBps: perHost[where.id] ?? null }) },
  }
  return { db, jobs, batches, perHost }
}

const job = (id: string, over: Partial<JobRow> = {}): JobRow => ({
  id, batchId: "b1", sourceConnectionId: "vc", config: { vcenterHost: "esx1" }, copyActiveAt: NOW, ...over,
})

describe("resolveCopyRateShare", () => {
  it("splits the batch cap between the batch's active copies", async () => {
    const { db } = fakeDb({ jobs: [job("a"), job("b")], batches: { b1: { mbps: 50 } } })
    expect(await resolveCopyRateShare(db, "a", NOW)).toEqual({ mbps: 25, reason: "batch cap 50 MB/s shared by 2 copies" })
  })

  it("ignores a copy whose heartbeat is older than 30 s", async () => {
    const { db } = fakeDb({ jobs: [job("a"), job("b", { copyActiveAt: new Date(NOW.getTime() - 31_000) })], batches: { b1: { mbps: 50 } } })
    expect((await resolveCopyRateShare(db, "a", NOW)).mbps).toBe(50)
  })

  it("counts the job itself even before its first heartbeat", async () => {
    const { db } = fakeDb({ jobs: [job("a", { copyActiveAt: null }), job("b")], batches: { b1: { mbps: 50 } } })
    expect((await resolveCopyRateShare(db, "a", NOW)).mbps).toBe(25)
  })

  it("lets a tighter source host cap win, shared with copies of other batches on the same host", async () => {
    const { db } = fakeDb({
      jobs: [job("a"), job("b"), job("c", { batchId: "b2" }), job("d", { batchId: "b2", config: { vcenterHost: "esx2" } })],
      batches: { b1: { mbps: 50 } }, perHost: { vc: 30 },
    })
    // batch b1: 50 / 2 = 25 ; host esx1 (a, b, c): 30 / 3 = 10
    expect(await resolveCopyRateShare(db, "a", NOW)).toEqual({ mbps: 10, reason: "source host cap 30 MB/s shared by 3 copies" })
  })

  it("gives a single migration its own cap, not shared", async () => {
    const { db } = fakeDb({ jobs: [job("a", { batchId: null, config: { vcenterHost: "esx1", copyRateLimit: { mbps: 40 } } }), job("b")] })
    expect(await resolveCopyRateShare(db, "a", NOW)).toEqual({ mbps: 40, reason: "migration cap 40 MB/s" })
  })

  it("follows the batch's time window", async () => {
    const schedule = { from: "08:00", to: "19:00", tz: "Europe/Paris", offHoursMbps: 0 }
    const { db } = fakeDb({ jobs: [job("a")], batches: { b1: { mbps: 50, schedule } } })
    expect((await resolveCopyRateShare(db, "a", NOW)).mbps).toBe(50) // 11:00 Paris
    expect((await resolveCopyRateShare(db, "a", new Date("2026-11-16T20:00:00Z"))).mbps).toBe(0)
  })

  it("is unlimited without any cap", async () => {
    const { db } = fakeDb({ jobs: [job("a")], batches: { b1: null } })
    expect(await resolveCopyRateShare(db, "a", NOW)).toEqual({ mbps: 0, reason: "no cap" })
  })

  it("reads an invalid stored cap as no cap", async () => {
    const { db } = fakeDb({ jobs: [job("a")], batches: { b1: { mbps: "fast" } } })
    expect((await resolveCopyRateShare(db, "a", NOW)).mbps).toBe(0)
  })
})

describe("startCopyRateGovernor", () => {
  function setup(init: Parameters<typeof fakeDb>[0], runResults: boolean[] = []) {
    const f = fakeDb(init)
    let t = NOW.getTime()
    const run = vi.fn(async (_cmd: string) => ({ success: runResults.length ? runResults.shift()! : true, error: "ssh down" }))
    const log = vi.fn(async (_m: string, _l?: "info" | "warn") => {})
    const clock = { now: () => new Date(t), advance: (ms: number) => { t += ms } }
    return { ...f, run, log, clock }
  }

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  /** One governor round: the default interval elapses. */
  async function tick() {
    await vi.advanceTimersByTimeAsync(10_000)
  }

  it("starts at the initial share, marks the copy active and writes only on change", async () => {
    const s = setup({ jobs: [job("a", { copyActiveAt: null }), job("b")], batches: { b1: { mbps: 50 } } })
    const g = await startCopyRateGovernor({ jobId: "a", sock: "/tmp/r.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    g.start()
    expect(g.initialMbps).toBe(25)
    expect(s.jobs.get("a")!.copyActiveAt).toEqual(NOW)
    expect(s.log).toHaveBeenCalledWith("Copy rate cap 25 MB/s (batch cap 50 MB/s shared by 2 copies)", "info")
    await tick()
    expect(s.run).not.toHaveBeenCalled()
    s.batches.b1 = { mbps: 30 }
    s.clock.advance(10_000)
    await tick()
    expect(s.run).toHaveBeenCalledTimes(1)
    expect(s.run.mock.calls[0][0]).toContain("120M")
    expect(s.log).toHaveBeenLastCalledWith("Copy rate cap now 15 MB/s (batch cap 30 MB/s shared by 2 copies)", "info")
    expect(s.jobs.get("a")!.copyActiveAt).toEqual(new Date(NOW.getTime() + 10_000))
    await g.stop()
  })

  it("does not repeat the starting cap of the next pass when it is unchanged", async () => {
    const s = setup({ jobs: [job("dedup")], batches: { b1: { mbps: 50 } } })
    const first = await startCopyRateGovernor({ jobId: "dedup", sock: "/tmp/r1.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    await first.stop()
    const second = await startCopyRateGovernor({ jobId: "dedup", sock: "/tmp/r2.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    await second.stop()
    expect(s.log.mock.calls.filter(c => String(c[0]).startsWith("Copy rate cap"))).toHaveLength(1)
    s.batches.b1 = { mbps: 20 }
    const third = await startCopyRateGovernor({ jobId: "dedup", sock: "/tmp/r3.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    await third.stop()
    expect(s.log).toHaveBeenLastCalledWith("Copy rate cap 20 MB/s (batch cap 20 MB/s shared by 1 copy)", "info")
  })

  it("keeps the job counted while another of its readers still copies", async () => {
    const s = setup({ jobs: [job("multi", { copyActiveAt: null })], batches: { b1: { mbps: 50 } } })
    const one = await startCopyRateGovernor({ jobId: "multi", sock: "/tmp/m1.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    const two = await startCopyRateGovernor({ jobId: "multi", sock: "/tmp/m2.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    await one.stop()
    expect(s.jobs.get("multi")!.copyActiveAt).not.toBeNull()
    await two.stop()
    expect(s.jobs.get("multi")!.copyActiveAt).toBeNull()
  })

  it("beats again after a slow rate file write, so peers keep counting the copy", async () => {
    const s = setup({ jobs: [job("slow")], batches: { b1: { mbps: 50 } } })
    s.run.mockImplementation(async () => { s.clock.advance(25_000); return { success: true, error: "" } })
    const g = await startCopyRateGovernor({ jobId: "slow", sock: "/tmp/s.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    g.start()
    s.batches.b1 = { mbps: 20 }
    await tick()
    expect(s.jobs.get("slow")!.copyActiveAt).toEqual(s.clock.now())
    await g.stop()
  })

  it("warns again on a later outage once the share came back to the one in force", async () => {
    const s = setup({ jobs: [job("out")], batches: { b1: { mbps: 50 } } }, [false, false])
    const g = await startCopyRateGovernor({ jobId: "out", sock: "/tmp/o.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    g.start()
    s.batches.b1 = { mbps: 20 }
    await tick() // write fails: warning
    s.batches.b1 = { mbps: 50 }
    await tick() // back to the share in force: nothing to write
    s.batches.b1 = { mbps: 20 }
    await tick() // fails again: a new outage, a new warning
    expect(s.log.mock.calls.filter(c => c[1] === "warn")).toHaveLength(2)
    await g.stop()
  })

  it("writes 0 when the cap is removed mid-pass", async () => {
    const s = setup({ jobs: [job("a")], batches: { b1: { mbps: 50 } } })
    const g = await startCopyRateGovernor({ jobId: "a", sock: "/tmp/r.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    g.start()
    s.batches.b1 = null
    await tick()
    expect(s.run.mock.calls[0][0]).toContain("printf '%s\\n' 0 >")
    expect(s.log).toHaveBeenLastCalledWith("Copy rate cap now unlimited (no cap)", "info")
    await g.stop()
  })

  it("keeps copying and warns once when the rate file cannot be written", async () => {
    const s = setup({ jobs: [job("a")], batches: { b1: { mbps: 50 } } }, [false, false, true])
    const g = await startCopyRateGovernor({ jobId: "a", sock: "/tmp/r.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    g.start()
    s.batches.b1 = { mbps: 20 }
    await tick()
    await tick()
    expect(s.log.mock.calls.filter(c => c[1] === "warn")).toHaveLength(1)
    await tick()
    expect(s.run).toHaveBeenCalledTimes(3)
    expect(s.log).toHaveBeenLastCalledWith("Copy rate cap now 20 MB/s (batch cap 20 MB/s shared by 1 copy)", "info")
    await g.stop()
  })

  it("keeps the last share when the database cannot be read", async () => {
    const s = setup({ jobs: [job("a")], batches: { b1: { mbps: 50 } } })
    const g = await startCopyRateGovernor({ jobId: "a", sock: "/tmp/r.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    g.start()
    s.db.migrationBatch.findUnique = async () => { throw new Error("db down") }
    await tick()
    expect(s.run).not.toHaveBeenCalled()
    await g.stop()
  })

  it("starts unlimited when the database cannot be read at the start", async () => {
    const s = setup({ jobs: [job("a")] })
    s.db.migrationJob.findUnique = async () => { throw new Error("db down") }
    const g = await startCopyRateGovernor({ jobId: "a", sock: "/tmp/r.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now })
    g.start()
    expect(g.initialMbps).toBe(0)
    await g.stop()
  })

  it("ticks on its own after start() and stops cleanly", async () => {
    const s = setup({ jobs: [job("a")], batches: { b1: { mbps: 50 } } })
    const g = await startCopyRateGovernor({ jobId: "a", sock: "/tmp/r.sock", run: s.run, log: s.log, db: s.db, now: s.clock.now, intervalMs: 10_000 })
    g.start()
    s.batches.b1 = { mbps: 10 }
    await vi.advanceTimersByTimeAsync(10_000)
    expect(s.run).toHaveBeenCalledTimes(1)
    await g.stop()
    expect(s.jobs.get("a")!.copyActiveAt).toBeNull()
    s.batches.b1 = { mbps: 5 }
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.run).toHaveBeenCalledTimes(1)
  })
})

describe("openCopyRateGovernor", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("runs no governor on an uncapped pass", async () => {
    const { db, jobs } = fakeDb({ jobs: [job("a", { copyActiveAt: null })], batches: { b1: { mbps: 50 } } })
    expect(await openCopyRateGovernor({ capped: false, jobId: "a", connectionId: "pve", nodeIp: "10.0.0.1", sock: "/tmp/r.sock", log: async () => {}, db })).toBeNull()
    // the copy does not count against its batch's cap
    expect(jobs.get("a")!.copyActiveAt).toBeNull()
  })

  it("writes the rate file on the target node over SSH", async () => {
    const f = fakeDb({ jobs: [job("a")], batches: { b1: { mbps: 50 } } })
    const g = await openCopyRateGovernor({ capped: true, jobId: "a", connectionId: "pve", nodeIp: "10.0.0.1", sock: "/tmp/r.sock", log: async () => {}, db: f.db })
    expect(g?.initialMbps).toBe(50)
    g!.start()
    f.batches.b1 = { mbps: 10 }
    await vi.advanceTimersByTimeAsync(10_000)
    expect(vi.mocked(executeSSH)).toHaveBeenCalledWith("pve", "10.0.0.1", expect.stringContaining("80M"))
    await g!.stop()
  })
})
