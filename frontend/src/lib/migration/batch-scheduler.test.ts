import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { prismaTest, truncate } from "@/__tests__/setup/prisma-test"

// The scheduler runs against the real test schema: its guarantees (row lock
// on the batch, conditional queued -> pending claim) are Postgres behaviour.
vi.mock("@/lib/db/prisma", async () => ({ prisma: (await import("@/__tests__/setup/prisma-test")).prismaTest }))
vi.mock("@/lib/migration/start-job", () => ({ startMigrationJob: vi.fn(async () => {}) }))
vi.mock("@/lib/migration/orphan-sweep", () => ({ resolveInstanceId: () => "inst-test" }))
const lease = vi.hoisted(() => ({ held: true }))
const rights = vi.hoisted(() => ({ migrate: true, view: true, manage: true, nic: true, infra: { kind: "provider" } as any }))
vi.mock("@/lib/rbac", () => ({
  hasPermission: vi.fn(async (c: any) => {
    if (c.permission === "connection.view") return rights.view
    if (c.permission === "connection.manage") return rights.manage
    if (c.permission === "vm.migrate") return rights.migrate
    return rights.nic
  }),
  PERMISSIONS: { VM_MIGRATE: "vm.migrate", CONNECTION_VIEW: "connection.view", CONNECTION_MANAGE: "connection.manage" },
}))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn(async () => rights.infra),
}))
vi.mock("@/lib/scheduler/lease", () => ({
  tryAcquireLease: vi.fn(async () => lease.held),
  releaseLease: vi.fn(async () => {}),
}))

import {
  BATCH_REVOKED_ERROR, JOB_REVOKED_ERROR, batchStillAuthorized, jobStillAuthorized, cancelQueuedJobs, holdsBatchSlot, launchInBackground, pauseBatch, pumpBatch, pumpRunningBatches, resumeBatch,
  startBatchPump, stopBatchPump,
} from "./batch-scheduler"
import { startMigrationJob } from "@/lib/migration/start-job"
import { backgroundTenantId } from "@/lib/tenant/background"

const start = startMigrationJob as unknown as ReturnType<typeof vi.fn>

// Every batch has a creator whose rights are read again before a start.
const CREATOR = "u-batch-creator"

async function makeBatch(n: number, { concurrency = 1, status = "running", tenantId = "default", createdBy = CREATOR as string | null } = {}) {
  const batch = await prismaTest.migrationBatch.create({
    data: { tenantId, sourceConnectionId: "src", targetConnectionId: "tgt", concurrency, status, createdBy },
  })
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const job = await prismaTest.migrationJob.create({
      data: {
        tenantId, sourceConnectionId: "src", sourceVmId: `vm-${i}`, sourceVmName: `vm-${i}`,
        targetConnectionId: "tgt", targetNode: "pve1", targetStorage: "local-lvm",
        config: { migrationType: "warm", sourceType: "vcenter" }, status: "queued", currentStep: "queued",
        batchId: batch.id, batchOrder: i,
      },
    })
    ids.push(job.id)
  }
  return { batchId: batch.id, ids }
}

const statusOf = async (id: string) => (await prismaTest.migrationJob.findUnique({ where: { id } }))!.status
const batchStatus = async (id: string) => (await prismaTest.migrationBatch.findUnique({ where: { id } }))!.status
const setStatus = (id: string, status: string) => prismaTest.migrationJob.update({ where: { id }, data: { status } })

beforeAll(async () => {
  await prismaTest.user.upsert({ where: { id: CREATOR }, update: { enabled: true }, create: { id: CREATOR, email: "creator@batch.test", name: "creator", password: "x", role: "user", tenantId: "default", createdAt: new Date(), updatedAt: new Date() } as any })
})

afterAll(async () => {
  await prismaTest.user.delete({ where: { id: CREATOR } }).catch(() => {})
})

beforeEach(async () => {
  await truncate(["migration_jobs", "migration_batches"])
  start.mockReset().mockResolvedValue(undefined)
  lease.held = true
  rights.migrate = true
  rights.view = true
  rights.manage = true
  rights.nic = true
  rights.infra = { kind: "provider" }
})

describe("holdsBatchSlot", () => {
  it("counts started, unfinished jobs only", () => {
    expect(holdsBatchSlot("queued")).toBe(false)
    expect(holdsBatchSlot("pending")).toBe(true)
    expect(holdsBatchSlot("full_copy")).toBe(true)
    for (const s of ["completed", "failed", "cancelled"]) expect(holdsBatchSlot(s)).toBe(false)
  })
})

describe("pumpBatch", () => {
  it("starts no more jobs than the batch concurrency, in batch order", async () => {
    const { batchId, ids } = await makeBatch(5, { concurrency: 2 })
    const launch = vi.fn()

    const res = await pumpBatch(batchId, { launch })

    expect(res.started).toEqual([ids[0], ids[1]])
    expect(launch).toHaveBeenCalledTimes(2)
    expect(launch.mock.calls[0][0]).toMatchObject({ id: ids[0], sourceVmId: "vm-0", config: { migrationType: "warm" } })
    expect(launch.mock.calls[0][1]).toBe("default")
    const claimed = await prismaTest.migrationJob.findUnique({ where: { id: ids[0] } })
    expect(claimed).toMatchObject({ status: "pending", currentStep: "pending", ownerInstanceId: "inst-test" })
    expect(claimed!.startedAt).toBeInstanceOf(Date)
    expect(await statusOf(ids[2])).toBe("queued")
  })

  it("fills only the free slots and starts the next one when a job ends", async () => {
    const { batchId, ids } = await makeBatch(3, { concurrency: 1 })
    const launch = vi.fn()
    await pumpBatch(batchId, { launch })
    await setStatus(ids[0], "full_copy")
    expect((await pumpBatch(batchId, { launch })).started).toEqual([])

    await setStatus(ids[0], "completed")
    expect((await pumpBatch(batchId, { launch })).started).toEqual([ids[1]])
  })

  it("never starts a job twice when pumps run concurrently", async () => {
    const { batchId } = await makeBatch(6, { concurrency: 2 })
    const launch = vi.fn()

    const results = await Promise.all(Array.from({ length: 5 }, () => pumpBatch(batchId, { launch })))

    const started = results.flatMap(r => r.started)
    expect(started).toHaveLength(2)
    expect(new Set(started).size).toBe(2)
    expect(await prismaTest.migrationJob.count({ where: { batchId, status: "pending" } })).toBe(2)
  })

  it("starts nothing while paused, and resume starts the queue again", async () => {
    const { batchId, ids } = await makeBatch(2, { concurrency: 1 })
    const launch = vi.fn()
    expect(await pauseBatch(batchId)).toBe(true)
    expect(await pauseBatch(batchId)).toBe(false)

    expect(await pumpBatch(batchId, { launch })).toEqual({ started: [], status: "paused" })
    expect(launch).not.toHaveBeenCalled()

    expect(await resumeBatch(batchId, { launch })).toBe(true)
    expect(await batchStatus(batchId)).toBe("running")
    expect(launch).toHaveBeenCalledTimes(1)
    expect(await statusOf(ids[0])).toBe("pending")
    expect(await resumeBatch(batchId, { launch })).toBe(false)
  })

  it("marks the batch completed once nothing is queued or running", async () => {
    const { batchId, ids } = await makeBatch(2, { concurrency: 2 })
    await pumpBatch(batchId, { launch: vi.fn() })
    await setStatus(ids[0], "completed")
    await setStatus(ids[1], "failed")

    expect((await pumpBatch(batchId, { launch: vi.fn() })).status).toBe("completed")
    expect(await batchStatus(batchId)).toBe("completed")
  })

  it("skips a queued job cancelled on its own and starts the next", async () => {
    const { batchId, ids } = await makeBatch(2, { concurrency: 1 })
    await setStatus(ids[0], "cancelled")

    expect((await pumpBatch(batchId, { launch: vi.fn() })).started).toEqual([ids[1]])
  })

  it("is a no-op for an unknown batch", async () => {
    expect(await pumpBatch("nope", { launch: vi.fn() })).toEqual({ started: [], status: null })
  })
})

describe("cancelQueuedJobs", () => {
  it("cancels the queued jobs, leaves the running one alone and closes the batch", async () => {
    const { batchId, ids } = await makeBatch(3, { concurrency: 1 })
    await pumpBatch(batchId, { launch: vi.fn() })

    expect(await cancelQueuedJobs(batchId)).toBe(2)

    expect(await statusOf(ids[0])).toBe("pending")
    expect(await statusOf(ids[1])).toBe("cancelled")
    expect(await statusOf(ids[2])).toBe("cancelled")
    expect(await batchStatus(batchId)).toBe("cancelled")
    const launch = vi.fn()
    await setStatus(ids[0], "completed")
    expect((await pumpBatch(batchId, { launch })).started).toEqual([])
    expect(await batchStatus(batchId)).toBe("cancelled")
  })
})

describe("pumpRunningBatches (restart)", () => {
  it("picks up every running batch, not the paused ones", async () => {
    const a = await makeBatch(2, { concurrency: 1 })
    const b = await makeBatch(2, { concurrency: 1, status: "paused" })
    // The startup sweep failed what the dead process was running.
    await pumpBatch(a.batchId, { launch: vi.fn() })
    await setStatus(a.ids[0], "failed")
    const launch = vi.fn()

    expect(await pumpRunningBatches({ launch })).toBe(1)
    expect(launch.mock.calls[0][0].id).toBe(a.ids[1])
    expect(await statusOf(b.ids[0])).toBe("queued")
  })
})

describe("launchInBackground", () => {
  it("runs the job, then pumps its batch so the next one starts", async () => {
    const { batchId, ids } = await makeBatch(2, { concurrency: 1 })
    await pumpBatch(batchId, { launch: vi.fn() })
    // The pipeline ends the first job; its end must start the second.
    start.mockImplementationOnce(async () => { await setStatus(ids[0], "completed") })
    const job = await prismaTest.migrationJob.findUnique({ where: { id: ids[0] } })

    launchInBackground(job as any, "default", batchId)

    await vi.waitFor(async () => expect(await statusOf(ids[1])).toBe("pending"))
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ id: ids[0] }), "default")
  })

  it("runs the pipeline with the batch tenant as its background tenant", async () => {
    const { batchId, ids } = await makeBatch(1, { tenantId: "msp-1" })
    let seen: string | undefined
    start.mockImplementationOnce(async () => { seen = backgroundTenantId() })

    launchInBackground({ id: ids[0] } as any, "msp-1", batchId)

    await vi.waitFor(() => expect(seen).toBe("msp-1"))
  })

  it("still pumps the batch when the pipeline throws", async () => {
    const { batchId, ids } = await makeBatch(2, { concurrency: 1 })
    await pumpBatch(batchId, { launch: vi.fn() })
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    start.mockImplementationOnce(async () => { await setStatus(ids[0], "failed"); throw new Error("boom") })

    launchInBackground({ id: ids[0] } as any, "default", batchId)

    await vi.waitFor(async () => expect(await statusOf(ids[1])).toBe("pending"))
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe("startBatchPump", () => {
  it("pumps the running batches only while holding the lease", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] })
    try {
      const { batchId, ids } = await makeBatch(1)
      lease.held = false
      startBatchPump()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await statusOf(ids[0])).toBe("queued")

      lease.held = true
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.waitFor(async () => expect(await statusOf(ids[0])).toBe("pending"))
      expect(await batchStatus(batchId)).toBe("running")
    } finally {
      stopBatchPump()
      vi.useRealTimers()
    }
  })
})

describe("rights re-checked before a queued job starts", () => {
  it("cancels the queue, with a reason, when the creator lost the right to migrate", async () => {
    const { batchId, ids } = await makeBatch(2, { concurrency: 1, createdBy: "u-gone" })
    const launch = vi.fn()

    const res = await pumpBatch(batchId, { launch, authorize: async () => false })

    expect(res).toEqual({ started: [], status: "cancelled" })
    expect(launch).not.toHaveBeenCalled()
    for (const id of ids) {
      expect(await prismaTest.migrationJob.findUnique({ where: { id } })).toMatchObject({ status: "cancelled", error: BATCH_REVOKED_ERROR })
    }
    expect(await batchStatus(batchId)).toBe("cancelled")
  })

  it("re-checks a paused batch too, so a resume racing the pump cannot skip it", async () => {
    const { batchId, ids } = await makeBatch(1, { status: "paused" })

    await pumpBatch(batchId, { launch: vi.fn(), authorize: async () => false })

    expect(await statusOf(ids[0])).toBe("cancelled")
    expect(await batchStatus(batchId)).toBe("cancelled")
  })

  it("does not re-check a batch with nothing left to start", async () => {
    const { batchId, ids } = await makeBatch(1)
    await setStatus(ids[0], "full_copy")
    const authorize = vi.fn(async () => false)

    await pumpBatch(batchId, { launch: vi.fn(), authorize })

    expect(authorize).not.toHaveBeenCalled()
  })

  it("batchStillAuthorized: tenant scope, enabled creator, vm.migrate in the batch tenant", async () => {
    const b = { tenantId: "default", createdBy: null as string | null, sourceConnectionId: "src", targetConnectionId: "tgt" }
    // Nobody whose rights can be read again: fail closed.
    expect(await batchStillAuthorized(b)).toBe(false)
    expect(await batchStillAuthorized({ ...b, createdBy: CREATOR })).toBe(true)

    rights.infra = { kind: "msp", connectionIds: new Set(["src"]) }
    expect(await batchStillAuthorized({ ...b, createdBy: CREATOR })).toBe(false)
    rights.infra = { kind: "provider" }

    const user = await prismaTest.user.create({ data: { id: `u-${Date.now()}`, email: `b-${Date.now()}@t.local`, name: "b", password: "x", role: "user", tenantId: "default", createdAt: new Date(), updatedAt: new Date() } as any })
    expect(await batchStillAuthorized({ ...b, createdBy: user.id })).toBe(true)
    rights.migrate = false
    expect(await batchStillAuthorized({ ...b, createdBy: user.id })).toBe(false)
    rights.migrate = true
    await prismaTest.user.update({ where: { id: user.id }, data: { enabled: false } })
    expect(await batchStillAuthorized({ ...b, createdBy: user.id })).toBe(false)
    expect(await batchStillAuthorized({ ...b, createdBy: "nobody" })).toBe(false)
    await prismaTest.user.delete({ where: { id: user.id } })
  })

  it("jobStillAuthorized: a pinned copy adapter needs connection.manage on the source, a tenant job its NIC rights", async () => {
    const b = { tenantId: "default", createdBy: CREATOR, sourceConnectionId: "src", targetConnectionId: "tgt" }
    const job = { targetConnectionId: "tgt", targetNode: "pve1", config: { networkBridge: "vmbr0" } as any }
    expect(await jobStillAuthorized(b, job)).toBe(true)
    rights.manage = false
    expect(await jobStillAuthorized(b, job)).toBe(true)
    expect(await jobStillAuthorized(b, { ...job, config: { networkBridge: "vmbr0", copyVmk: "vmk2" } })).toBe(false)
    rights.manage = true
    // Provider tenant: no NIC permission applies; a tenant job with a VLAN needs them.
    rights.nic = false
    expect(await jobStillAuthorized(b, { ...job, config: { networkBridge: "vmbr0", vlanTag: 42 } })).toBe(true)
    expect(await jobStillAuthorized({ ...b, tenantId: "t1" }, { ...job, config: { networkBridge: "vmbr0", vlanTag: 42 } })).toBe(false)
    expect(await jobStillAuthorized({ ...b, createdBy: null }, job)).toBe(false)
  })

  it("fails a claimed job that lost its own rights instead of starting it, and starts the others", async () => {
    const { batchId, ids } = await makeBatch(2, { concurrency: 2 })
    const launch = vi.fn()
    const authorizeJob = vi.fn(async (_b: unknown, job: { id: string }) => job.id !== ids[0])

    const res = await pumpBatch(batchId, { launch, authorizeJob })

    expect(res.started).toEqual([ids[1]])
    expect(launch).toHaveBeenCalledTimes(1)
    expect(await prismaTest.migrationJob.findUnique({ where: { id: ids[0] } })).toMatchObject({ status: "failed", error: JOB_REVOKED_ERROR })
  })

  it("batchStillAuthorized: a provider creator needs connection.view on a connection another tenant owns", async () => {
    const user = await prismaTest.user.create({ data: { id: `u-${Date.now()}`, email: `v-${Date.now()}@t.local`, name: "v", password: "x", role: "user", tenantId: "default", createdAt: new Date(), updatedAt: new Date() } as any })
    await prismaTest.tenant.upsert({ where: { id: "msp-x" }, update: {}, create: { id: "msp-x", slug: "msp-x", name: "MSP X", operatingModel: "msp", createdAt: new Date(), updatedAt: new Date() } as any })
    await prismaTest.connection.create({ data: { id: "tgt", name: "MSP PVE", type: "pve", baseUrl: "https://pve", apiTokenEnc: "x", tenantId: "msp-x" } as any })
    const b = { tenantId: "default", createdBy: user.id, sourceConnectionId: "src", targetConnectionId: "tgt" }
    try {
      expect(await batchStillAuthorized(b)).toBe(true)
      rights.view = false
      expect(await batchStillAuthorized(b)).toBe(false)
      // An MSP batch reads its own connections: no provider guard.
      expect(await batchStillAuthorized({ ...b, tenantId: "msp-x" })).toBe(true)
    } finally {
      await prismaTest.connection.delete({ where: { id: "tgt" } })
      await prismaTest.user.delete({ where: { id: user.id } })
    }
  })
})
