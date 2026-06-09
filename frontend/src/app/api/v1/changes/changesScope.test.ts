import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../__tests__/setup/route-test"

const { getInfraMock, orchestratorFetchMock, tenantConnectionIdsMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  orchestratorFetchMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
}))

// Keep real maskingScope; only stub getTenantInfrastructureScope
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => "t1",
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a),
}))

vi.mock("@/lib/orchestrator/client", () => ({
  orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", ADMIN_SETTINGS: "admin.settings" },
}))

// Two test records: one cluster-less (no connectionId), one with connectionId c1
const CLUSTER_LESS = { id: "ev1", node: "n1", pool: null }
const CONN_RECORD = { id: "ev2", connectionId: "c1", node: "n1", pool: "pool-a" }

beforeEach(() => {
  vi.clearAllMocks()
  tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))
  orchestratorFetchMock.mockResolvedValue({ data: [CLUSTER_LESS, CONN_RECORD] })
})

describe("GET /api/v1/changes scope routing", () => {
  it("provider: cluster-less record is KEPT", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((r: any) => r.id)
    expect(ids).toContain("ev1")
    expect(ids).toContain("ev2")
  })

  it("msp: cluster-less record is DROPPED, owned-connection record is KEPT (no masking)", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((r: any) => r.id)
    expect(ids).not.toContain("ev1")
    expect(ids).toContain("ev2")
  })

  it("iaas: cluster-less record is DROPPED, connection record passes connection check but node/pool mask applies", async () => {
    const vdcScope = {
      connectionIds: new Set(["c1"]),
      pbsConnectionIds: new Set<string>(),
      // node n1 is allowed on c1
      nodesByConnection: new Map([["c1", new Set(["n1"])]]),
      // pool-a is allowed on c1
      poolsByConnection: new Map([["c1", new Set(["pool-a"])]]),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((r: any) => r.id)
    // cluster-less must be gone
    expect(ids).not.toContain("ev1")
    // c1 / node n1 / pool pool-a all in scope -> kept
    expect(ids).toContain("ev2")
  })

  it("iaas: drops a connection record whose node is outside the vDC scope", async () => {
    const vdcScope = {
      connectionIds: new Set(["c1"]),
      pbsConnectionIds: new Set<string>(),
      // only node n2 allowed, but the record is on n1
      nodesByConnection: new Map([["c1", new Set(["n2"])]]),
      poolsByConnection: new Map<string, Set<string>>(),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((r: any) => r.id)
    expect(ids).not.toContain("ev1")
    expect(ids).not.toContain("ev2")
  })
})
