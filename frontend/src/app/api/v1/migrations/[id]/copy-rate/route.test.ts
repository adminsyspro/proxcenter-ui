import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  job: null as any,
  batch: null as any,
  denied: null as any,
  licensed: true,
  prisma: {
    migrationJob: { findFirst: vi.fn(), update: vi.fn(async () => ({})) },
    migrationBatch: { findUnique: vi.fn() },
    connection: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => h.denied), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/migration/authorize", () => ({ migrateScope: vi.fn(async () => null), scopedJobWhere: (where: object) => where }))
vi.mock("@/lib/auth/requireEnterprise", () => ({ hasServerFeature: vi.fn(async () => h.licensed) }))
vi.mock("@/lib/migration/warm/copy-rate-governor", () => ({ resolveCopyRateShare: vi.fn(async () => ({ mbps: 20, reason: "batch cap 40 MB/s shared by 2 copies" })), HEARTBEAT_TTL_MS: 30_000 }))

import { GET, PATCH } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const read = () => callRoute(GET, { method: "GET", params: { id: "j1" } })
const patch = (body?: any) => callRoute(PATCH, { method: "PATCH", params: { id: "j1" }, body })

beforeEach(() => {
  h.denied = null
  h.licensed = true
  h.job = { id: "j1", status: "full_copy", batchId: null, sourceConnectionId: "src", copyActiveAt: null, config: { migrationType: "warm", copyRateLimit: { mbps: 40 } } }
  h.batch = { copyRateLimit: { mbps: 80 } }
  h.prisma.migrationJob.findFirst.mockReset().mockImplementation(async () => h.job)
  h.prisma.migrationJob.update.mockReset().mockResolvedValue({})
  h.prisma.migrationBatch.findUnique.mockReset().mockImplementation(async () => h.batch)
  h.prisma.connection.findUnique.mockReset().mockResolvedValue({ migrationCopyRateLimitPerHostMBps: 30 })
})

describe("GET /api/v1/migrations/[id]/copy-rate", () => {
  it("answers the migration's own cap, the source host cap and no share while it does not copy", async () => {
    expect(await readJson<any>(await read())).toEqual({
      data: { copyRateLimit: { mbps: 40 }, scope: "job", batchId: null, perHostMbps: 30, effectiveMbps: null, editable: true },
    })
  })

  it("answers the batch's cap for a migration of a batch, and the share in force while it copies", async () => {
    h.job = { ...h.job, batchId: "b1", copyActiveAt: new Date(), config: { migrationType: "warm" } }
    expect((await readJson<any>(await read())).data).toEqual({ copyRateLimit: { mbps: 80 }, scope: "batch", batchId: "b1", perHostMbps: 30, effectiveMbps: 20, editable: true })
  })

  it("answers 404 for a migration the caller cannot see", async () => {
    h.job = null
    expect((await read()).status).toBe(404)
  })
})

describe("PATCH /api/v1/migrations/[id]/copy-rate", () => {
  it("changes the cap of a single migration, and clears it with null", async () => {
    const res = await patch({ copyRateLimit: { mbps: 25 } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { copyRateLimit: { mbps: 25 } } })
    expect(h.prisma.migrationJob.update).toHaveBeenCalledWith({ where: { id: "j1" }, data: { config: { migrationType: "warm", copyRateLimit: { mbps: 25 } } } })

    expect((await patch({ copyRateLimit: null })).status).toBe(200)
    expect(h.prisma.migrationJob.update).toHaveBeenLastCalledWith({ where: { id: "j1" }, data: { config: { migrationType: "warm" } } })
  })

  it("refuses an invalid value", async () => {
    const res = await patch({ copyRateLimit: { mbps: 1.5 } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/copyRateLimit/)
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it("refuses a finished or cold migration", async () => {
    h.job.status = "completed"
    expect((await patch({ copyRateLimit: { mbps: 25 } })).status).toBe(400)
    h.job = { ...h.job, status: "full_copy", config: { migrationType: "cold" } }
    expect((await patch({ copyRateLimit: { mbps: 25 } })).status).toBe(400)
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it("sends a migration of a batch to the batch", async () => {
    h.job.batchId = "b1"
    const res = await patch({ copyRateLimit: { mbps: 25 } })
    expect(res.status).toBe(409)
    expect((await readJson<any>(res)).error).toMatch(/batch/)
  })

  it("needs the migration feature", async () => {
    h.licensed = false
    expect((await patch({ copyRateLimit: { mbps: 25 } })).status).toBe(403)
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it("needs vm.migrate", async () => {
    const { NextResponse } = await import("next/server")
    h.denied = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    expect((await patch({ copyRateLimit: { mbps: 25 } })).status).toBe(403)
  })
})
