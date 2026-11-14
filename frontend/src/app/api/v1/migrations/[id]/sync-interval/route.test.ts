import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  job: null as any,
  denied: null as any,
  prisma: {
    migrationJob: { findFirst: vi.fn(), update: vi.fn(async () => ({})) },
    connection: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => h.denied), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/migration/authorize", () => ({ migrateScope: vi.fn(async () => null), scopedJobWhere: (where: object) => where }))

import { GET, PATCH } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const MEASURE = { changeRateBytesPerSec: 1048576, throughputBytesPerSec: 52428800, passOverheadSec: 10, fixedDowntimeSec: 50 }
const read = () => callRoute(GET, { method: "GET", params: { id: "j1" } })
const patch = (body?: any) => callRoute(PATCH, { method: "PATCH", params: { id: "j1" }, body })

beforeEach(() => {
  h.denied = null
  h.job = {
    id: "j1", status: "delta_sync", sourceConnectionId: "src", cutoverRequestedAt: null, suggestedSyncIntervalSec: 900, syncMeasure: { ...MEASURE },
    config: { migrationType: "warm", cutoverMode: "manual", syncIntervalSec: 300, convertGuest: true },
  }
  h.prisma.migrationJob.findFirst.mockReset().mockImplementation(async () => h.job)
  h.prisma.migrationJob.update.mockReset().mockResolvedValue({})
  h.prisma.connection.findUnique.mockReset().mockResolvedValue({ migrationSyncIntervalSec: 3600 })
})

describe("GET /api/v1/migrations/[id]/sync-interval", () => {
  it("answers the interval the migration syncs at, its own, with the suggestion of the engine", async () => {
    expect(await readJson<any>(await read())).toEqual({
      data: { syncIntervalSec: 300, overridden: true, defaultSyncIntervalSec: 3600, suggestedSyncIntervalSec: 900, measure: MEASURE, editable: true },
    })
  })

  it("answers the setting of the source connection for a migration without its own", async () => {
    delete h.job.config.syncIntervalSec
    h.job.suggestedSyncIntervalSec = null
    h.job.syncMeasure = null

    expect((await readJson<any>(await read())).data).toEqual({ syncIntervalSec: 3600, overridden: false, defaultSyncIntervalSec: 3600, suggestedSyncIntervalSec: null, measure: null, editable: true })
  })

  it("says a migration that no longer waits cannot be changed", async () => {
    h.job.status = "completed"
    expect((await readJson<any>(await read())).data.editable).toBe(false)
  })

  it("answers 404 for a migration the caller cannot see", async () => {
    h.job = null
    expect((await read()).status).toBe(404)
  })
})

describe("PATCH /api/v1/migrations/[id]/sync-interval", () => {
  it("writes the interval into the config of the waiting migration, keeping the rest of it", async () => {
    const res = await patch({ syncIntervalSec: 7200 })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { syncIntervalSec: 7200, overridden: true } })
    expect(h.prisma.migrationJob.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: { config: { migrationType: "warm", cutoverMode: "manual", syncIntervalSec: 7200, convertGuest: true } },
    })
  })

  it("goes back to the setting of the source connection on null", async () => {
    const res = await patch({ syncIntervalSec: null })

    expect(await readJson<any>(res)).toEqual({ data: { syncIntervalSec: 3600, overridden: false } })
    expect(h.prisma.migrationJob.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: { config: { migrationType: "warm", cutoverMode: "manual", convertGuest: true } },
    })
  })

  it.each([[30], [86401], [90.5], ["soon"], [undefined]])("refuses %s as an interval", async value => {
    const res = await patch({ syncIntervalSec: value })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe("syncIntervalSec must be an integer between 60 and 86400 seconds, or null for the setting of the source connection")
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it.each([
    ["an automatic cutover", { config: { migrationType: "warm", cutoverMode: "auto" } }],
    ["a cold migration", { config: { migrationType: "cold" } }],
    ["a finished migration", { status: "completed" }],
    ["a migration whose cutover was requested", { cutoverRequestedAt: new Date() }],
  ])("refuses %s", async (_label, over) => {
    Object.assign(h.job, over)
    const res = await patch({ syncIntervalSec: 600 })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe("Only a warm migration that waits for a manual cutover has an interval between two syncs")
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it("lets a queued migration of a batch be set before it starts", async () => {
    h.job.status = "queued"
    expect((await patch({ syncIntervalSec: 600 })).status).toBe(200)
  })

  it("answers the permission refusal as is", async () => {
    h.denied = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
    expect((await patch({ syncIntervalSec: 600 })).status).toBe(403)
    expect(h.prisma.migrationJob.findFirst).not.toHaveBeenCalled()
  })
})
