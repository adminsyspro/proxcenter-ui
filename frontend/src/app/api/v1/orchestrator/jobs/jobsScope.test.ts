/**
 * Task 15 (security): GET /api/v1/orchestrator/jobs used to build its
 * connection perimeter from getSessionPrisma() -- empty for iaas tenants
 * (provider-pool connections reached only via vDC binding), under-inclusive
 * for the provider (excludes MSP-owned connections) -- and, worse, treated
 * a job with NO connectionId/sourceCluster/targetCluster as "no key = pass"
 * instead of denying it. These tests pin the corrected behaviour: provider
 * fleet view unchanged, iaas perimeter follows the narrowed vDC view
 * context (not the wider tenant union), msp uses its owned-connection
 * union, and any job carrying no linkage at all is excluded for everyone
 * except the provider.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { getInfraMock, getCurrentTenantIdMock, tenantConnectionIdsMock, findManyMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
  findManyMock: vi.fn(),
}))

// Keep the real maskingScope (pure function); only stub the scope resolver.
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a),
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { connection: { findMany: (...a: any[]) => findManyMock(...a) } },
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { TASKS_VIEW: "tasks.view" },
}))

vi.mock("@/lib/orchestrator/headers", () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => extra,
}))

const ALL_CONNS = [
  { id: "c1", name: "cluster-1", baseUrl: "https://pve1.example.com:8006" },
  { id: "c2", name: "cluster-2", baseUrl: "https://pve2.example.com:8006" },
]

findManyMock.mockImplementation(async ({ where }: any) => {
  const ids: string[] = where?.id?.in ?? []
  return ALL_CONNS.filter(c => ids.includes(c.id))
})

const ROLLING_UPDATES = [
  { id: "ru-c1", connection_id: "c1", status: "running", total_nodes: 2, completed_nodes: 1, started_at: "2026-01-01T00:00:00Z" },
  { id: "ru-c2", connection_id: "c2", status: "running", total_nodes: 2, completed_nodes: 1, started_at: "2026-01-01T00:00:00Z" },
  // No connection_id at all -- must be denied for every non-provider caller.
  { id: "ru-none", status: "running", total_nodes: 1, completed_nodes: 0, started_at: "2026-01-01T00:00:00Z" },
]
const DRS_MIGRATIONS = [
  { id: "dm-c1", connection_id: "c1", vmid: 100, vm_name: "vm1", status: "completed", started_at: "2026-01-01T00:00:00Z" },
]

const fetchMock = vi.fn(async (url: string) => {
  if (url.includes("/rolling-updates")) return { ok: true, json: async () => ({ data: ROLLING_UPDATES }) }
  if (url.includes("/drs/migrations")) return { ok: true, json: async () => ({ data: DRS_MIGRATIONS }) }
  return { ok: true, json: async () => ({ data: [] }) }
})
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/rolling-updates")) return { ok: true, json: async () => ({ data: ROLLING_UPDATES }) }
    if (url.includes("/drs/migrations")) return { ok: true, json: async () => ({ data: DRS_MIGRATIONS }) }
    return { ok: true, json: async () => ({ data: [] }) }
  })
  findManyMock.mockImplementation(async ({ where }: any) => {
    const ids: string[] = where?.id?.in ?? []
    return ALL_CONNS.filter(c => ids.includes(c.id))
  })
})

describe("GET /api/v1/orchestrator/jobs — tenant scoping", () => {
  it("provider: sees the whole fleet, including a job with no connection linkage", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    getInfraMock.mockResolvedValue({ kind: "provider" })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((j: any) => j.id)
    expect(ids).toContain("ru-c1")
    expect(ids).toContain("ru-c2")
    expect(ids).toContain("ru-none")
    expect(ids).toContain("dm-c1")
  })

  it("iaas: perimeter follows the narrowed vDC view context, not the wider tenant union; unlinked job denied", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    // Union spans c1+c2 (two vDCs on shared clusters), but the active vDC
    // view context only narrows to c1.
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: { connectionIds: new Set(["c1"]) },
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((j: any) => j.id)
    expect(ids).toContain("ru-c1")
    expect(ids).toContain("dm-c1")
    expect(ids).not.toContain("ru-c2")
    expect(ids).not.toContain("ru-none")
  })

  it("msp: perimeter uses the owned-connection union (no vDC narrowing)", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-msp")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((j: any) => j.id)
    expect(ids).toContain("ru-c1")
    expect(ids).not.toContain("ru-c2")
    expect(ids).not.toContain("ru-none")
  })
})
