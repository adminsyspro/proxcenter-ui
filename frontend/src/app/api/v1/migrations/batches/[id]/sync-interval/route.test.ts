import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  access: null as any,
  jobs: [] as any[],
  prisma: { migrationJob: { findMany: vi.fn(), update: vi.fn(async () => ({})) } },
}))

vi.mock("@/lib/migration/batch-access", () => ({ loadBatchForCaller: vi.fn(async () => h.access) }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => "audit-1") }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { audit } from "@/lib/audit"

const manual = { migrationType: "warm", cutoverMode: "manual" }
const post = (body?: any) => callRoute(POST, { method: "POST", params: { id: "b1" }, body })

beforeEach(() => {
  h.jobs = [
    { id: "j-queued", sourceVmName: "web-1", status: "queued", cutoverRequestedAt: null, config: { ...manual } },
    { id: "j-hold", sourceVmName: "web-2", status: "delta_sync", cutoverRequestedAt: null, config: { ...manual, syncIntervalSec: 60 } },
    { id: "j-cutting", sourceVmName: "web-3", status: "delta_sync", cutoverRequestedAt: new Date(), config: { ...manual } },
    { id: "j-done", sourceVmName: "web-4", status: "completed", cutoverRequestedAt: null, config: { ...manual } },
  ]
  h.prisma.migrationJob.findMany.mockReset().mockImplementation(async () => h.jobs)
  h.prisma.migrationJob.update.mockReset().mockResolvedValue({})
  h.access = { ok: true, batch: { id: "b1", status: "running" }, prisma: h.prisma, tenantId: "default" }
})

describe("POST /api/v1/migrations/batches/[id]/sync-interval", () => {
  it("sets the interval of every migration of the batch that still waits, and names the others", async () => {
    const res = await post({ syncIntervalSec: 3600 })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({
      data: {
        updated: ["j-queued", "j-hold"],
        skipped: [
          { jobId: "j-cutting", sourceVmName: "web-3", status: "delta_sync" },
          { jobId: "j-done", sourceVmName: "web-4", status: "completed" },
        ],
      },
    })
    expect(h.prisma.migrationJob.update).toHaveBeenCalledWith({ where: { id: "j-hold" }, data: { config: { ...manual, syncIntervalSec: 3600 } } })
  })

  it("names in the audit log the VMs changed and the interval set", async () => {
    vi.mocked(audit).mockClear()
    await post({ syncIntervalSec: 600, jobIds: ["j-hold"] })

    expect(audit).toHaveBeenCalledWith({
      category: "migration", action: "update", resourceType: "batch", resourceId: "b1", status: "success",
      details: { operation: "sync-interval", syncIntervalSec: 600, updated: [{ jobId: "j-hold", sourceVmName: "web-2" }], skipped: [] },
    })
  })

  it("limits the change to the selected migrations", async () => {
    const res = await post({ syncIntervalSec: 600, jobIds: ["j-hold"] })

    expect((await readJson<any>(res)).data).toEqual({ updated: ["j-hold"], skipped: [] })
    expect(h.prisma.migrationJob.update).toHaveBeenCalledTimes(1)
  })

  it("puts the selected migrations back on the setting of the source connection on null", async () => {
    await post({ syncIntervalSec: null, jobIds: ["j-hold"] })

    expect(h.prisma.migrationJob.update).toHaveBeenCalledWith({ where: { id: "j-hold" }, data: { config: { ...manual } } })
  })

  it("refuses a value outside the bounds, and changes nothing", async () => {
    const res = await post({ syncIntervalSec: 10 })

    expect(res.status).toBe(400)
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it("refuses a selection naming a migration that is not in the batch", async () => {
    const res = await post({ syncIntervalSec: 600, jobIds: ["j-hold", "j-elsewhere"] })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe("jobIds must list migrations of this batch")
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it("keeps going when one row cannot be written, and says which", async () => {
    h.prisma.migrationJob.update.mockRejectedValueOnce(new Error("row locked"))
    const res = await post({ syncIntervalSec: 600, jobIds: ["j-queued", "j-hold"] })

    expect((await readJson<any>(res)).data).toEqual({
      updated: ["j-hold"],
      skipped: [{ jobId: "j-queued", sourceVmName: "web-1", status: "queued", error: "row locked" }],
    })
  })

  it("answers the access refusal as is", async () => {
    h.access = { ok: false, response: new Response(null, { status: 404 }) }
    expect((await post({ syncIntervalSec: 600 })).status).toBe(404)
  })
})
