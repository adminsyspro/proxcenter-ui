import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import { prismaTest, truncate } from "@/__tests__/setup/prisma-test"

// Real test schema: the reclaim serialises on the same Postgres locks as the
// batch scheduler.
vi.mock("@/lib/db/prisma", async () => ({ prisma: (await import("@/__tests__/setup/prisma-test")).prismaTest }))

// Releasing a place pumps the job's batch so a queued VM takes it; the real
// scheduler would start pipelines, so only the call is observed here.
const pump = vi.hoisted(() => vi.fn(async (_batchId: string) => ({ started: [], status: "running" })))
vi.mock("@/lib/migration/batch-scheduler", () => ({ pumpBatch: pump }))

import { holdBetweenPasses, reclaimHoldSlot, releaseHoldSlot } from "./hold-slot"
import { cancelWarmMigrationJob, requestWarmCutover, unregisterJob } from "./job-control"

const conn = (id: string, type: string, extra: Record<string, unknown> = {}) => prismaTest.$transaction([
  prismaTest.connection.create({ data: { id, name: id, type, baseUrl: `https://${id}`, apiTokenEnc: "x", ...extra } as any }),
  ...(type === "pve" ? [prismaTest.providerConnection.create({ data: { connectionId: id } })] : []),
])
const dropConns = () => prismaTest.$transaction([
  prismaTest.providerConnection.deleteMany({ where: { connectionId: { in: ["src", "tgt"] } } }),
  prismaTest.connection.deleteMany({ where: { id: { in: ["src", "tgt"] } } }),
])

let seq = 0
const job = (over: Record<string, unknown> = {}) => prismaTest.migrationJob.create({
  data: {
    tenantId: "default", sourceConnectionId: "src", sourceVmId: `vm-${seq++}`, sourceVmName: "vm",
    targetConnectionId: "tgt", targetNode: "pve1", targetStorage: "local-lvm",
    config: { migrationType: "warm", sourceType: "vcenter", vcenterHost: "esx1", cutoverMode: "manual" },
    status: "delta_sync", currentStep: "delta_1", ...over,
  },
})
const idleOf = async (id: string) => (await prismaTest.migrationJob.findUniqueOrThrow({ where: { id } })).holdIdleAt

beforeEach(async () => {
  await truncate(["migration_jobs", "migration_batches"])
  await dropConns()
  pump.mockClear()
  vi.restoreAllMocks()
})
const batch = (status = "running") => prismaTest.migrationBatch.create({ data: { tenantId: "default", sourceConnectionId: "src", targetConnectionId: "tgt", concurrency: 2, status } })
afterAll(dropConns)

describe("releaseHoldSlot / reclaimHoldSlot", () => {
  it("marks the job idle, then takes its place back when the limits leave room", async () => {
    const j = await job()
    await releaseHoldSlot(j.id)
    expect(await idleOf(j.id)).toBeInstanceOf(Date)

    expect(await reclaimHoldSlot(j.id)).toBe(true)
    expect(await idleOf(j.id)).toBeNull()
  })

  it("waits while its target node is full", async () => {
    await conn("tgt", "pve", { migrationMaxPerNode: 1 })
    await job({ status: "full_copy" })
    const j = await job({ holdIdleAt: new Date() })

    expect(await reclaimHoldSlot(j.id)).toBe(false)
    expect(await idleOf(j.id)).toBeInstanceOf(Date)
  })

  it("waits while its ESXi host already serves its limit", async () => {
    await conn("tgt", "pve", { migrationMaxPerNode: 5 })
    await conn("src", "vmware", { migrationMaxPerSourceHost: 1 })
    await job({ status: "full_copy", targetNode: "pve2" })
    const j = await job({ holdIdleAt: new Date() })

    expect(await reclaimHoldSlot(j.id)).toBe(false)
  })

  it("waits while the target cluster is full", async () => {
    await conn("tgt", "pve", { migrationMaxParallel: 1, migrationMaxPerNode: 1 })
    await job({ status: "full_copy", targetNode: "pve2", config: { vcenterHost: "esx2" } })
    const j = await job({ holdIdleAt: new Date() })

    expect(await reclaimHoldSlot(j.id)).toBe(false)
  })

  it("does not count the other jobs asleep in their hold, nor queued or finished ones", async () => {
    await conn("tgt", "pve", { migrationMaxPerNode: 1 })
    await job({ holdIdleAt: new Date() })
    await job({ status: "queued" })
    await job({ status: "completed" })
    const j = await job({ holdIdleAt: new Date() })

    expect(await reclaimHoldSlot(j.id)).toBe(true)
  })

  it("lets only one of two jobs through when a single place is left", async () => {
    await conn("tgt", "pve", { migrationMaxPerNode: 1 })
    const a = await job({ holdIdleAt: new Date() })
    const b = await job({ holdIdleAt: new Date() })

    const won = await Promise.all([reclaimHoldSlot(a.id), reclaimHoldSlot(b.id)])
    expect(won.filter(Boolean)).toHaveLength(1)
  })
})

describe("holdBetweenPasses", () => {
  it("sleeps the interval, then goes on to the next pass with its place back", async () => {
    const j = await job()
    await expect(holdBetweenPasses(j.id, 0.02)).resolves.toBe("pass")
    expect(await idleOf(j.id)).toBeNull()
  })

  it("is idle for the whole sleep", async () => {
    const j = await job()
    const waiting = holdBetweenPasses(j.id, 0.3)
    await new Promise(r => setTimeout(r, 100))
    expect(await idleOf(j.id)).toBeInstanceOf(Date)
    await waiting
  })

  it("leaves for the cutover at once when it is requested during the sleep", async () => {
    const j = await job()
    setTimeout(() => requestWarmCutover(j.id), 50)
    await expect(holdBetweenPasses(j.id, 60)).resolves.toBe("cutover")
    expect(await idleOf(j.id)).toBeNull()
    unregisterJob(j.id)
  })

  it("leaves for the cutover at once when it is requested while waiting for a place", async () => {
    await conn("tgt", "pve", { migrationMaxPerNode: 1 })
    await job({ status: "full_copy" })
    const j = await job()
    setTimeout(() => requestWarmCutover(j.id), 150)
    await expect(holdBetweenPasses(j.id, 0.02, { reclaimRetryMs: 20 })).resolves.toBe("cutover")
    expect(await idleOf(j.id)).toBeNull()
    unregisterJob(j.id)
  })

  it("tells once that it waits for a place", async () => {
    await conn("tgt", "pve", { migrationMaxPerNode: 1 })
    const blocker = await job({ status: "full_copy" })
    const j = await job()
    const onWait = vi.fn()
    // A Prisma promise only runs once it is awaited or chained.
    setTimeout(() => { prismaTest.migrationJob.update({ where: { id: blocker.id }, data: { status: "completed" } }).catch(() => {}) }, 120)
    await expect(holdBetweenPasses(j.id, 0.02, { reclaimRetryMs: 20, onWaitForSlot: onWait })).resolves.toBe("pass")
    expect(onWait).toHaveBeenCalledTimes(1)
  })

  it("ends a long sleep early when the interval is shortened meanwhile", async () => {
    const j = await job()
    let sec = 60
    setTimeout(() => { sec = 0.1 }, 80)
    const started = Date.now()

    await expect(holdBetweenPasses(j.id, async () => sec, { intervalRecheckMs: 20 })).resolves.toBe("pass")
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("sleeps on when the interval is lengthened meanwhile", async () => {
    const j = await job()
    let sec = 0.1
    setTimeout(() => { sec = 0.5 }, 40)
    const started = Date.now()

    await expect(holdBetweenPasses(j.id, async () => sec, { intervalRecheckMs: 20 })).resolves.toBe("pass")
    expect(Date.now() - started).toBeGreaterThanOrEqual(480)
  })

  it("stops on a cancellation", async () => {
    const j = await job()
    setTimeout(() => cancelWarmMigrationJob(j.id), 50)
    await expect(holdBetweenPasses(j.id, 60)).rejects.toThrow(/cancelled/i)
    unregisterJob(j.id)
  })
})

describe("a wave that still has VMs to seed", () => {
  it("pumps the batch of the job when it gives its place back, so a queued VM takes it", async () => {
    const b = await batch()
    const j = await job({ batchId: b.id })
    await releaseHoldSlot(j.id)
    await vi.waitFor(() => expect(pump).toHaveBeenCalledWith(b.id))
  })

  it("leaves a free place to a queued VM of a running batch into the same cluster", async () => {
    const b = await batch()
    await job({ status: "queued", batchId: b.id })
    const j = await job({ holdIdleAt: new Date() })

    expect(await reclaimHoldSlot(j.id, { yieldToQueue: true })).toBe(false)
    expect(await reclaimHoldSlot(j.id)).toBe(true)
  })

  it("does not wait for the queue of a paused batch", async () => {
    const b = await batch("paused")
    await job({ status: "queued", batchId: b.id })
    const j = await job({ holdIdleAt: new Date() })

    expect(await reclaimHoldSlot(j.id, { yieldToQueue: true })).toBe(true)
  })

  it("stops yielding to the queue after three more intervals, so a waiting VM still syncs during a long wave", async () => {
    const b = await batch()
    await job({ status: "queued", batchId: b.id })
    const j = await job()
    const started = Date.now()

    await expect(holdBetweenPasses(j.id, 0.05, { reclaimRetryMs: 10 })).resolves.toBe("pass")
    expect(Date.now() - started).toBeGreaterThanOrEqual(190)
    expect(await idleOf(j.id)).toBeNull()
  })
})

describe("a database hiccup while a migration only waits", () => {
  it("keeps waiting when the place cannot be given back", async () => {
    const j = await job()
    vi.spyOn(prismaTest.migrationJob, "updateMany").mockRejectedValueOnce(new Error("pool timeout"))

    await expect(holdBetweenPasses(j.id, 0.02)).resolves.toBe("pass")
    expect(await idleOf(j.id)).toBeNull()
  })

  it("tries again when taking the place back fails", async () => {
    const j = await job()
    vi.spyOn(prismaTest, "$transaction").mockRejectedValueOnce(new Error("Transaction API error: P2028"))

    await expect(holdBetweenPasses(j.id, 0.02, { reclaimRetryMs: 10 })).resolves.toBe("pass")
    expect(await idleOf(j.id)).toBeNull()
  })
})

// The hold notices a cutover request within a second (its sleep is sliced),
// so the cutover already running is ended after 1.5 s: later than that.
describe("cutovers requested together", () => {
  const cuttingOver = (over: Record<string, unknown> = {}) => job({ status: "cutover", cutoverRequestedAt: new Date(), ...over })

  it("does not wait behind the copies that fill its node", async () => {
    await conn("tgt", "pve", { migrationMaxPerNode: 1 })
    await job({ status: "full_copy" })
    const j = await job()
    setTimeout(() => requestWarmCutover(j.id), 40)

    await expect(holdBetweenPasses(j.id, 60, { reclaimRetryMs: 10 })).resolves.toBe("cutover")
    unregisterJob(j.id)
  })

  it("waits its turn when its node already runs as many cutovers as its limit", async () => {
    await conn("tgt", "pve", { migrationMaxPerNode: 1 })
    const other = await cuttingOver()
    const j = await job()
    const onWait = vi.fn()
    setTimeout(() => requestWarmCutover(j.id), 30)
    setTimeout(() => { prismaTest.migrationJob.update({ where: { id: other.id }, data: { status: "completed" } }).catch(() => {}) }, 1500)
    const started = Date.now()

    await expect(holdBetweenPasses(j.id, 60, { reclaimRetryMs: 10, onWaitForCutoverSlot: onWait })).resolves.toBe("cutover")
    expect(Date.now() - started).toBeGreaterThanOrEqual(1450)
    expect(onWait).toHaveBeenCalledTimes(1)
    expect(await idleOf(j.id)).toBeNull()
    unregisterJob(j.id)
  })

  it("waits its turn when its ESXi host already serves as many cutovers as its limit", async () => {
    await conn("tgt", "pve", { migrationMaxPerNode: 5 })
    await conn("src", "vmware", { migrationMaxPerSourceHost: 1 })
    const other = await cuttingOver({ targetNode: "pve2" })
    const j = await job()
    setTimeout(() => requestWarmCutover(j.id), 30)
    setTimeout(() => { prismaTest.migrationJob.update({ where: { id: other.id }, data: { status: "completed" } }).catch(() => {}) }, 1500)
    const started = Date.now()

    await expect(holdBetweenPasses(j.id, 60, { reclaimRetryMs: 10 })).resolves.toBe("cutover")
    expect(Date.now() - started).toBeGreaterThanOrEqual(1450)
    unregisterJob(j.id)
  })
})
