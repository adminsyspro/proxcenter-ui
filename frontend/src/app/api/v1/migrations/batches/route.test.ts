import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const h = vi.hoisted(() => ({
  afterCbs: [] as Array<() => Promise<void>>,
  tenantId: "default",
  infra: { kind: "provider" } as any,
  denied: null as Response | null,
  validate: vi.fn(),
  batch: null as any,
  jobs: [] as any[],
  created: [] as any[],
  prisma: {} as any,
  tx: {} as any,
}))

vi.mock("next/server", async (io) => {
  const actual = await io<typeof import("next/server")>()
  return { ...actual, after: (fn: () => Promise<void>) => { h.afterCbs.push(fn) } }
})
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => h.denied), PERMISSIONS: { VM_MIGRATE: "vm.migrate", CONNECTION_VIEW: "connection.view" } }))
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: vi.fn(async () => h.prisma),
  getCurrentTenantId: vi.fn(async () => h.tenantId),
}))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn(async () => h.infra),
}))
const space = vi.hoisted(() => ({ result: { ok: true, problems: [] as any[], warnings: [] as any[] }, check: vi.fn() }))
vi.mock("@/lib/migration/batch-space", async (orig) => ({
  ...(await orig<typeof import("@/lib/migration/batch-space")>()),
  checkBatchSpaceForRequest: space.check,
}))
const copy = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock("@/lib/migration/batch-copy-reach", () => ({ checkBatchCopyNetwork: copy.check }))
const runtime = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock("@/lib/migration/batch-warm-runtime", () => ({ checkBatchWarmRuntime: runtime.check }))
vi.mock("@/lib/migration/validate-request", () => ({ validateMigrationRequest: h.validate }))
vi.mock("@/lib/migration/batch-scheduler", () => ({
  OPEN_BATCH_STATUSES: ["running", "paused"],
  QUEUED_STATUS: "queued",
  pumpBatch: vi.fn(async () => ({ started: [], status: "running" })),
  pauseBatch: vi.fn(async () => true),
  resumeBatch: vi.fn(async () => true),
  cancelQueuedJobs: vi.fn(async () => 2),
}))
vi.mock("@/lib/tasks/sharedTask", () => ({ TERMINAL_STATUSES: ["completed", "failed", "cancelled"] }))
const globalConn = vi.hoisted(() => ({ findMany: vi.fn(async () => [{ id: "src", type: "vmware", subType: "vcenter" }]) }))
vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: globalConn } }))

import { GET as LIST, POST as CREATE, MAX_BATCH_VMS } from "./route"
import { GET as DETAIL } from "./[id]/route"
import { POST as PAUSE } from "./[id]/pause/route"
import { POST as RESUME } from "./[id]/resume/route"
import { POST as CANCEL } from "./[id]/cancel-queued/route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { cancelQueuedJobs, pauseBatch, pumpBatch, resumeBatch } from "@/lib/migration/batch-scheduler"

const shared = { sourceConnectionId: "src", targetConnectionId: "tgt", targetStorage: "ceph", migrationType: "warm", networkBridge: "vmbr0" }
const vms = [
  { sourceVmId: "vm-1", sourceVmName: "web-1", targetNode: "pve1", vcenterDatacenter: "DC" },
  { sourceVmId: "vm-2", sourceVmName: "web-2", targetNode: "pve2" },
]

function validated(body: any) {
  return {
    ok: true,
    value: {
      sourceConnectionId: body.sourceConnectionId, sourceVmId: body.sourceVmId, sourceVmName: body.sourceVmName ?? null,
      sourceHost: "https://vc", targetConnectionId: body.targetConnectionId, targetNode: body.targetNode, targetStorage: body.targetStorage,
      sourceConn: { type: "vmware", subType: "vcenter" }, config: { ...body, sourceType: "vcenter" },
    },
  }
}

beforeEach(() => {
  h.afterCbs.length = 0
  h.tenantId = "default"
  h.infra = { kind: "provider" }
  h.denied = null
  h.created = []
  h.batch = { id: "b1", tenantId: "default", sourceConnectionId: "src", targetConnectionId: "tgt", concurrency: 2, status: "running" }
  h.jobs = []
  h.validate.mockReset().mockImplementation(async (body: any) => validated(body))
  space.check.mockReset().mockImplementation(async () => space.result)
  space.result = { ok: true, problems: [], warnings: [] } as any
  copy.check.mockReset().mockResolvedValue({ assignment: {}, problems: [], infos: [], unchecked: [] })
  runtime.check.mockReset().mockResolvedValue([])
  const tx = h.tx = {
    migrationBatch: { create: vi.fn(async ({ data }: any) => ({ id: "b1", ...data })) },
    migrationJob: { create: vi.fn(async ({ data }: any) => { h.created.push(data); return { id: `j${h.created.length}` } }) },
  }
  h.prisma = {
    $transaction: vi.fn(async (fn: any) => fn(tx)),
    migrationBatch: {
      findUnique: vi.fn(async () => h.batch),
      findMany: vi.fn(async () => [{ ...h.batch, jobs: [{ status: "full_copy" }, { status: "queued" }] }]),
    },
    migrationJob: { findMany: vi.fn(async () => h.jobs) },
  }
  vi.mocked(pumpBatch).mockClear()
  globalConn.findMany.mockClear()
  vi.mocked(pauseBatch).mockReset().mockResolvedValue(true)
  vi.mocked(resumeBatch).mockReset().mockResolvedValue(true)
  vi.mocked(cancelQueuedJobs).mockReset().mockResolvedValue(2)
})

const create = (body: any) => callRoute(CREATE, { method: "POST", body })

describe("POST /api/v1/migrations/batches", () => {
  it("validates every VM with the shared options, creates them queued in order, then pumps the batch", async () => {
    const res = await create({ ...shared, concurrency: 2, vms })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { batchId: "b1", jobIds: ["j1", "j2"] } })
    expect(h.validate).toHaveBeenCalledTimes(2)
    expect(h.validate.mock.calls[0][0]).toEqual({ ...shared, ...vms[0] })
    expect(h.validate.mock.calls[1][0]).toEqual({ ...shared, ...vms[1] })
    expect(h.validate.mock.calls[0][1]).toMatchObject({ tenantId: "default" })
    expect(h.created.map(j => [j.sourceVmId, j.status, j.batchOrder, j.batchId, j.targetNode])).toEqual([
      ["vm-1", "queued", 0, "b1", "pve1"],
      ["vm-2", "queued", 1, "b1", "pve2"],
    ])
    // Not started: the scheduler sets the owner and start time when it claims a job.
    expect(h.created[0]).not.toHaveProperty("startedAt")
    expect(h.created[0]).not.toHaveProperty("ownerInstanceId")
    expect(h.created[0]).toMatchObject({ tenantId: "default", createdBy: "u1", config: expect.objectContaining({ vcenterDatacenter: "DC" }) })
    expect(pumpBatch).not.toHaveBeenCalled()
    for (const cb of h.afterCbs) await cb()
    expect(pumpBatch).toHaveBeenCalledWith("b1")
  })

  it("checks the target storage for the whole batch with each VM's disk bytes", async () => {
    await create({ ...shared, vms: [{ ...vms[0], diskBytes: 3e9 }, { ...vms[1], diskBytes: "2000" }] })

    expect(space.check).toHaveBeenCalledWith({
      tenantId: "default", sourceConnectionId: "src", targetConnectionId: "tgt", storage: "ceph",
      vms: [{ sourceVmId: "vm-1", targetNode: "pve1", estimatedBytes: 3e9 }, { sourceVmId: "vm-2", targetNode: "pve2", estimatedBytes: 2000 }],
    })
    expect(h.prisma.$transaction).toHaveBeenCalled()
  })

  it("refuses a batch the target storage cannot hold, and creates nothing", async () => {
    space.result = { ok: false, problems: [{ message: "Not enough space on ZFS-Pool (pve1): 6.7 GB free, this batch needs 9.0 GB plus a 10% margin" }], warnings: [] }

    const res = await create({ ...shared, vms })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe("Not enough space on ZFS-Pool (pve1): 6.7 GB free, this batch needs 9.0 GB plus a 10% margin")
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })

  it("re-checks the copy network of a warm VMware batch, VM by VM on the requested nodes", async () => {
    await create({ ...shared, copyVmk: "vmk1", copyAddress: "192.168.1.103", vms })

    expect(copy.check).toHaveBeenCalledWith(expect.objectContaining({
      sourceConnectionId: "src", targetConnectionId: "tgt", auto: false,
      candidates: ["pve1", "pve2"], requested: { "vm-1": "pve1", "vm-2": "pve2" },
    }))
  })

  it("refuses a warm batch whose node cannot reach a VM's copy adapter", async () => {
    copy.check.mockResolvedValueOnce({ assignment: {}, infos: [], unchecked: [], problems: [{ message: "pve3 cannot reach vmk2 10.42.53.21 (host 10.42.0.21) on port 902" }] })

    const res = await create({ ...shared, vms })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe("pve3 cannot reach vmk2 10.42.53.21 (host 10.42.0.21) on port 902")
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })

  it("checks the warm runtime of the batch's nodes with the source type", async () => {
    await create({ ...shared, vms })

    expect(runtime.check).toHaveBeenCalledWith({ sourceConnectionId: "src", sourceType: "vmware", targetConnectionId: "tgt", nodes: ["pve1", "pve2"] })
  })

  it("refuses a warm batch whose node lacks the warm runtime, and creates nothing", async () => {
    runtime.check.mockResolvedValueOnce([{ node: "pve2", missing: ["vddk-lib"], message: "pve2 is not ready for warm migration: missing vddk-lib" }])

    const res = await create({ ...shared, vms })

    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toBe("pve2 is not ready for warm migration: missing vddk-lib")
    expect(body.problems).toEqual([{ node: "pve2", missing: ["vddk-lib"], message: "pve2 is not ready for warm migration: missing vddk-lib" }])
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })

  it("does not probe the copy network of a cold batch", async () => {
    await create({ ...shared, migrationType: "cold", vms })
    expect(copy.check).not.toHaveBeenCalled()
    expect(runtime.check).not.toHaveBeenCalled()
  })

  it("starts a batch whose only shortfall rests on estimated sizes", async () => {
    space.result = { ok: true, problems: [], warnings: [{ message: "Maybe not enough space…", estimated: true }] }
    expect((await create({ ...shared, vms })).status).toBe(200)
  })

  it("does not let a shared per-VM field override the VM's own", async () => {
    await create({ ...shared, sourceVmId: "evil", targetNode: "pve9", vms: [{ sourceVmId: "vm-1", targetNode: "pve1" }] })

    expect(h.validate.mock.calls[0][0]).toMatchObject({ sourceVmId: "vm-1", targetNode: "pve1" })
  })

  it("creates nothing when one VM is refused, and names that VM", async () => {
    h.validate.mockImplementation(async (body: any) => body.sourceVmId === "vm-2"
      ? { ok: false, response: NextResponse.json({ error: "A migration of this source VM is already in progress", jobId: "x" }, { status: 409 }) }
      : validated(body))

    const res = await create({ ...shared, vms })

    expect(res.status).toBe(409)
    expect(await readJson<any>(res)).toMatchObject({ error: expect.stringContaining("already in progress"), sourceVmId: "vm-2" })
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    [{ concurrency: 0 }, "concurrency"],
    [{ concurrency: 6 }, "concurrency"],
    [{ concurrency: 1.5 }, "concurrency"],
    [{ vms: [] }, "vms"],
    [{ vms: [vms[0], vms[0]] }, "twice"],
    [{ disks: [{ index: 1, targetStorage: "ZFS-Pool" }] }, "disks"],
    [{ vms: [{ ...vms[0], disks: [{ index: 1, exclude: true }] }] }, "disks"],
    [{ vms: Array.from({ length: MAX_BATCH_VMS + 1 }, (_, i) => ({ sourceVmId: `v${i}`, targetNode: "pve1" })) }, "vms"],
  ])("refuses %j", async (over, word) => {
    const res = await create({ ...shared, vms, ...over })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toContain(word)
    expect(h.validate).not.toHaveBeenCalled()
  })

  it("defaults to one at a time", async () => {
    await create({ ...shared, vms })
    expect(h.tx.migrationBatch.create).toHaveBeenCalledWith({ data: expect.objectContaining({ concurrency: 1, status: "running", sourceConnectionId: "src", targetConnectionId: "tgt" }) })
  })

  it("needs vm.migrate", async () => {
    h.denied = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    expect((await create({ ...shared, vms })).status).toBe(403)
  })

  it("needs the right to view both connections, like the space and copy checks it runs", async () => {
    const { checkPermission } = await import("@/lib/rbac")
    vi.mocked(checkPermission).mockImplementation(async (perm: string, _t?: string, id?: string) =>
      perm === "connection.view" && id === "tgt" ? NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any : null)
    try {
      expect((await create({ ...shared, vms })).status).toBe(403)
      expect(checkPermission).toHaveBeenCalledWith("connection.view", "connection", "src")
      expect(h.tx.migrationBatch.create).not.toHaveBeenCalled()
      expect(space.check).not.toHaveBeenCalled()
    } finally {
      vi.mocked(checkPermission).mockImplementation(async () => h.denied as any)
    }
  })
})

describe("GET /api/v1/migrations/batches", () => {
  it("filters on the source and on open batches, with per-state counts", async () => {
    const res = await callRoute(LIST, { url: "http://localhost/api/v1/migrations/batches?active=1&sourceConnectionId=src" })

    expect(res.status).toBe(200)
    const where = h.prisma.migrationBatch.findMany.mock.calls[0][0].where
    expect(where.sourceConnectionId).toBe("src")
    expect(where.OR).toHaveLength(2)
    expect((await readJson<any>(res)).data[0]).toMatchObject({ id: "b1", sourceType: "vcenter", total: 2, counts: { running: 1, queued: 1 } })
  })

  it("hides the batches between clusters the tenant may not migrate between", async () => {
    h.tenantId = "msp-1"
    h.infra = { kind: "msp", connectionIds: new Set(["src"]) }

    const res = await callRoute(LIST, { url: "http://localhost/api/v1/migrations/batches" })

    expect((await readJson<any>(res)).data).toEqual([])
    expect(globalConn.findMany).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/migrations/batches/[id]", () => {
  it("returns the batch and its jobs with numeric counters", async () => {
    h.jobs = [{ id: "j1", status: "full_copy", bytesTransferred: BigInt(5), totalBytes: null, logs: null }]

    const res = await callRoute(DETAIL, { params: { id: "b1" } })

    expect(res.status).toBe(200)
    const data = (await readJson<any>(res)).data
    expect(data).toMatchObject({ id: "b1", status: "running", counts: { running: 1 } })
    expect(data.jobs[0]).toMatchObject({ id: "j1", bytesTransferred: 5, totalBytes: null, logs: [] })
  })

  it("answers a bare 404 for a batch of another tenant", async () => {
    h.batch = null
    const res = await callRoute(DETAIL, { params: { id: "b1" } })
    expect(res.status).toBe(404)
    expect(await readJson<any>(res)).toEqual({ error: "Migration batch not found" })
  })

  it("answers the same 404 to a vDC tenant", async () => {
    h.tenantId = "t-iaas"
    h.infra = { kind: "iaas", vdcScope: {} }
    expect((await callRoute(DETAIL, { params: { id: "b1" } })).status).toBe(404)
  })
})

describe("pause, resume, cancel-queued", () => {
  it("pauses a running batch", async () => {
    const res = await callRoute(PAUSE, { method: "POST", params: { id: "b1" } })
    expect(res.status).toBe(200)
    expect(pauseBatch).toHaveBeenCalledWith("b1")
  })

  it("refuses to pause a batch that is not running", async () => {
    vi.mocked(pauseBatch).mockResolvedValueOnce(false)
    h.batch.status = "completed"
    const res = await callRoute(PAUSE, { method: "POST", params: { id: "b1" } })
    expect(res.status).toBe(409)
  })

  it("resumes a paused batch and refuses otherwise", async () => {
    expect((await callRoute(RESUME, { method: "POST", params: { id: "b1" } })).status).toBe(200)
    vi.mocked(resumeBatch).mockResolvedValueOnce(false)
    expect((await callRoute(RESUME, { method: "POST", params: { id: "b1" } })).status).toBe(409)
  })

  it("cancels the queue of an open batch", async () => {
    const res = await callRoute(CANCEL, { method: "POST", params: { id: "b1" } })
    expect(await readJson<any>(res)).toEqual({ data: { status: "cancelled", cancelled: 2 } })
  })

  it("refuses to cancel the queue of a finished batch", async () => {
    h.batch.status = "completed"
    expect((await callRoute(CANCEL, { method: "POST", params: { id: "b1" } })).status).toBe(409)
    expect(cancelQueuedJobs).not.toHaveBeenCalled()
  })

  it("never acts on a batch outside the caller's reach", async () => {
    h.batch = null
    for (const route of [PAUSE, RESUME, CANCEL]) {
      expect((await callRoute(route, { method: "POST", params: { id: "b1" } })).status).toBe(404)
    }
    expect(pauseBatch).not.toHaveBeenCalled()
    expect(resumeBatch).not.toHaveBeenCalled()
    expect(cancelQueuedJobs).not.toHaveBeenCalled()
  })
})
