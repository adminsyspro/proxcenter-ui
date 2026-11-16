import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  access: null as any,
  licensed: true,
  prisma: {
    migrationBatch: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    connection: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/migration/batch-access", () => ({ loadBatchForCaller: vi.fn(async () => h.access) }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => "audit-1") }))
vi.mock("@/lib/auth/requireEnterprise", () => ({ hasServerFeature: vi.fn(async () => h.licensed) }))

import { GET, POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { audit } from "@/lib/audit"
import { Prisma } from "@prisma/client"

const read = () => callRoute(GET, { method: "GET", params: { id: "b1" } })
const post = (body?: any) => callRoute(POST, { method: "POST", params: { id: "b1" }, body })

beforeEach(() => {
  h.licensed = true
  h.access = { ok: true, batch: { id: "b1", status: "running", sourceConnectionId: "src" }, prisma: h.prisma, tenantId: "default" }
  h.prisma.migrationBatch.findUnique.mockReset().mockResolvedValue({ copyRateLimit: { mbps: 80 } })
  h.prisma.migrationBatch.update.mockReset().mockResolvedValue({})
  h.prisma.connection.findUnique.mockReset().mockResolvedValue({ migrationCopyRateLimitPerHostMBps: null })
  vi.mocked(audit).mockClear()
})

describe("GET /api/v1/migrations/batches/[id]/copy-rate", () => {
  it("answers the batch's cap and the source host cap", async () => {
    expect(await readJson<any>(await read())).toEqual({ data: { copyRateLimit: { mbps: 80 }, perHostMbps: null, editable: true } })
  })

  it("answers the refusal of the batch access", async () => {
    const { NextResponse } = await import("next/server")
    h.access = { ok: false, response: NextResponse.json({ error: "Migration batch not found" }, { status: 404 }) }
    expect((await read()).status).toBe(404)
  })
})

describe("POST /api/v1/migrations/batches/[id]/copy-rate", () => {
  it("changes the batch's cap and audits it", async () => {
    const cap = { mbps: 50, schedule: { from: "08:00", to: "19:00", tz: "Europe/Paris", offHoursMbps: 0 } }
    const res = await post({ copyRateLimit: cap })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { copyRateLimit: cap } })
    expect(h.prisma.migrationBatch.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { copyRateLimit: cap } })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ resourceType: "batch", resourceId: "b1", details: { operation: "copy-rate", copyRateLimit: cap } }))
  })

  it("clears the batch's cap with null", async () => {
    const res = await post({ copyRateLimit: null })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { copyRateLimit: null } })
    expect(h.prisma.migrationBatch.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { copyRateLimit: Prisma.DbNull } })
  })

  it("refuses an invalid value", async () => {
    expect((await post({ copyRateLimit: { mbps: "fast" } })).status).toBe(400)
    expect(h.prisma.migrationBatch.update).not.toHaveBeenCalled()
  })

  it("refuses a batch that is over", async () => {
    h.access.batch.status = "completed"
    expect((await post({ copyRateLimit: { mbps: 50 } })).status).toBe(409)
    expect(h.prisma.migrationBatch.update).not.toHaveBeenCalled()
  })

  it("needs the migration feature", async () => {
    h.licensed = false
    expect((await post({ copyRateLimit: { mbps: 50 } })).status).toBe(403)
  })
})
