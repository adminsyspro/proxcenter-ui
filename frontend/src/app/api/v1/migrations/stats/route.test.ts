import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  tenantId: "default",
  infra: { kind: "provider" } as any,
  denied: null as Response | null,
  session: { connection: { findMany: vi.fn() }, migrationJob: { groupBy: vi.fn() } },
  global: { connection: { findMany: vi.fn() } },
}))

vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => h.denied), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.session), getCurrentTenantId: vi.fn(async () => h.tenantId) }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn(async () => h.infra),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: h.global }))

import { GET } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const call = async () => readJson<any>(await callRoute(GET, { url: "http://localhost/api/v1/migrations/stats" }))

beforeEach(() => {
  vi.clearAllMocks()
  h.tenantId = "default"; h.infra = { kind: "provider" }; h.denied = null
  h.global.connection.findMany.mockResolvedValue([{ id: "vc", type: "vmware" }, { id: "msp-xcp", type: "xcpng" }])
  h.session.connection.findMany.mockResolvedValue([{ id: "msp-xcp", type: "xcpng" }])
  h.session.migrationJob.groupBy.mockResolvedValue([
    { sourceConnectionId: "vc", status: "completed", _count: { _all: 60 }, _sum: { bytesTransferred: BigInt(3 * 2 ** 30) } },
    { sourceConnectionId: "msp-xcp", status: "failed", _count: { _all: 1 }, _sum: { bytesTransferred: null } },
  ])
})

describe("GET /api/v1/migrations/stats", () => {
  it("counts over the whole history: no take, grouped per source and status, through the tenant's session client", async () => {
    const body = await call()
    const args = h.session.migrationJob.groupBy.mock.calls[0][0]
    expect(args).toMatchObject({ by: ["sourceConnectionId", "status"], where: { sourceConnectionId: { in: ["vc", "msp-xcp"] } } })
    expect(args.take).toBeUndefined()
    expect(body.data.bySource.vc).toMatchObject({ completed: 60, bytesTransferred: 3 * 2 ** 30 })
    expect(body.data.byType).toMatchObject({ vmware: { completed: 60 }, xcpng: { failed: 1 } })
  })

  it("reads the visible sources like the inventory: the global client for the provider, the tenant's own for an MSP", async () => {
    await call()
    expect(h.global.connection.findMany).toHaveBeenCalled()
    expect(h.session.connection.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    h.tenantId = "msp-1"; h.infra = { kind: "msp", connectionIds: new Set(["msp-xcp"]) }
    h.session.connection.findMany.mockResolvedValue([{ id: "msp-xcp", type: "xcpng" }])
    h.session.migrationJob.groupBy.mockResolvedValue([])
    await call()
    expect(h.global.connection.findMany).not.toHaveBeenCalled()
    expect(h.session.migrationJob.groupBy.mock.calls[0][0].where).toEqual({ sourceConnectionId: { in: ["msp-xcp"] } })
  })

  it("answers empty with no visible source, and refuses without vm.migrate", async () => {
    h.global.connection.findMany.mockResolvedValue([])
    expect((await call()).data).toEqual({ bySource: {}, byType: {} })
    expect(h.session.migrationJob.groupBy).not.toHaveBeenCalled()

    h.denied = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
    const res = await callRoute(GET, { url: "http://localhost/api/v1/migrations/stats" })
    expect(res.status).toBe(403)
  })
})
