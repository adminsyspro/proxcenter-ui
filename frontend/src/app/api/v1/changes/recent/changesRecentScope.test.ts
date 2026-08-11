import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../../__tests__/setup/route-test"

const { getInfraMock, orchestratorFetchMock, tenantConnectionIdsMock, vdcVmidsMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  orchestratorFetchMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
  vdcVmidsMock: vi.fn(),
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

vi.mock("@/lib/alerts/vdcVmids", () => ({
  getVdcVmidsByConnection: (...a: any[]) => vdcVmidsMock(...a),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))

// Same contract as /api/v1/changes: no pool field on change records, guest
// ownership (VMID in the vDC pools) is the mask for vDC tenants.
const CLUSTER_LESS = { id: "ev1", node: "n1", resourceType: "vm", resourceId: "100" }
const VM_OWNED = { id: "ev2", connectionId: "c1", node: "n1", resourceType: "vm", resourceId: "100" }
const VM_NEIGHBOUR = { id: "ev4", connectionId: "c1", node: "n1", resourceType: "vm", resourceId: "999" }
const NODE_EVENT = { id: "ev5", connectionId: "c1", node: "n1", resourceType: "node", resourceId: "n1" }

const IAAS_SCOPE = {
  connectionIds: new Set(["c1"]),
  pbsConnectionIds: new Set<string>(),
  nodesByConnection: new Map([["c1", new Set(["n1"])]]),
  poolsByConnection: new Map([["c1", new Set(["pool-a"])]]),
}

beforeEach(() => {
  vi.clearAllMocks()
  tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))
  vdcVmidsMock.mockResolvedValue(new Map([["c1", new Set(["100"])]]))
  orchestratorFetchMock.mockResolvedValue({ data: [CLUSTER_LESS, VM_OWNED, VM_NEIGHBOUR, NODE_EVENT] })
})

describe("GET /api/v1/changes/recent scope routing", () => {
  it("provider: every record is KEPT, including cluster-less ones", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((r: any) => r.id)
    expect(ids).toEqual(["ev1", "ev2", "ev4", "ev5"])
  })

  it("msp: cluster-less record is DROPPED, owned-connection records are KEPT (no guest masking)", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((r: any) => r.id)
    expect(ids).toEqual(["ev2", "ev4", "ev5"])
  })

  it("iaas: only the vDC-owned guest record survives — neighbour VM and node/infra events are DROPPED", async () => {
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope: IAAS_SCOPE })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((r: any) => r.id)
    expect(ids).toEqual(["ev2"])
  })

  it("iaas: excludes a record from a connection present in the tenant union but absent from the narrowed vDC scope", async () => {
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))
    const VM_OTHER_VDC = { id: "ev3", connectionId: "c2", node: "n1", resourceType: "vm", resourceId: "100" }
    orchestratorFetchMock.mockResolvedValue({ data: [VM_OWNED, VM_OTHER_VDC] })
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope: IAAS_SCOPE })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((r: any) => r.id)
    expect(ids).toEqual(["ev2"])
  })

  it("honors the limit param after filtering", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { limit: "2" } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data).toHaveLength(2)
  })
})
