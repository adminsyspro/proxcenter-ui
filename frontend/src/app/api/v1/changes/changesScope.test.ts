import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../__tests__/setup/route-test"
import { connectionScope, guestDerivedScope, nodeScope } from "@/__tests__/setup/rbacScope"

const { getInfraMock, orchestratorFetchMock, rbacScopeMock, tenantConnectionIdsMock, vdcVmidsMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  orchestratorFetchMock: vi.fn(),
  rbacScopeMock: vi.fn(),
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
  getCurrentRbacInfraScope: rbacScopeMock,
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", ADMIN_SETTINGS: "admin.settings" },
}))

// Change records carry no pool field (orchestrator struct) — visibility for
// vDC tenants rides on guest ownership (VMID in the vDC pools).
const CLUSTER_LESS = { id: "ev1", node: "n1", resourceType: "vm", resourceId: "100" }
const VM_OWNED = { id: "ev2", connectionId: "c1", node: "n1", resourceType: "vm", resourceId: "100" }
const VM_NEIGHBOUR = { id: "ev4", connectionId: "c1", node: "n1", resourceType: "vm", resourceId: "999" }
const NODE_EVENT = { id: "ev5", connectionId: "c1", node: "n1", resourceType: "node", resourceId: "n1" }
const VM_OTHER_NODE = { id: "ev6", connectionId: "c1", node: "n2", resourceType: "vm", resourceId: "101" }
const STORAGE_EVENT = { id: "ev7", connectionId: "c1", resourceType: "storage", resourceId: "local-lvm" }

const IAAS_SCOPE = {
  connectionIds: new Set(["c1"]),
  pbsConnectionIds: new Set<string>(),
  nodesByConnection: new Map([["c1", new Set(["n1"])]]),
  poolsByConnection: new Map([["c1", new Set(["pool-a"])]]),
}

beforeEach(() => {
  vi.clearAllMocks()
  rbacScopeMock.mockResolvedValue(null)
  tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))
  vdcVmidsMock.mockResolvedValue(new Map([["c1", new Set(["100"])]]))
  orchestratorFetchMock.mockResolvedValue({ data: [CLUSTER_LESS, VM_OWNED, VM_NEIGHBOUR, NODE_EVENT] })
})

describe("RBAC infra scope (issue #525)", () => {
  const ids = (body: any) => body.data.map((r: any) => r.id)

  beforeEach(() => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    orchestratorFetchMock.mockResolvedValue({ data: [CLUSTER_LESS, VM_OWNED, VM_NEIGHBOUR, NODE_EVENT, VM_OTHER_NODE, STORAGE_EVENT] })
  })

  it("admin (null scope): the provider feed stays unrestricted", async () => {
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(ids(await res.json())).toEqual(["ev1", "ev2", "ev4", "ev5", "ev6", "ev7"])
    expect(rbacScopeMock).toHaveBeenCalledWith("connection.view")
  })

  it("node scope: granted-node records and cluster-level records survive, the rest is dropped", async () => {
    rbacScopeMock.mockResolvedValue(nodeScope("c1", "n1"))
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    // ev1 has no connection, ev6 ran on n2; ev7 (storage) is a fact about c1.
    expect(ids(await res.json())).toEqual(["ev2", "ev4", "ev5", "ev7"])
  })

  it("connection scope on another connection: nothing survives", async () => {
    rbacScopeMock.mockResolvedValue(connectionScope("c2"))
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect((await res.json()).data).toEqual([])
  })

  it("guest-derived scope: tenant-level perimeter, minus connection-less records", async () => {
    rbacScopeMock.mockResolvedValue(guestDerivedScope())
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(ids(await res.json())).toEqual(["ev2", "ev4", "ev5", "ev6", "ev7"])
  })
})
