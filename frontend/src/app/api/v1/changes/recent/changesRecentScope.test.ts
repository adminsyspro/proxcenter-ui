import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../../__tests__/setup/route-test"
import { connectionScope, nodeScope } from "@/__tests__/setup/rbacScope"

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
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))

// Same contract as /api/v1/changes: no pool field on change records, guest
// ownership (VMID in the vDC pools) is the mask for vDC tenants.
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
  // The record gate itself is covered by lib/changes/visibility.test.ts and
  // by the sibling /api/v1/changes suite; the dropdown only adds the limit.
  beforeEach(() => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
  })

  it("applies the limit AFTER the RBAC filter so a scoped user still gets a full dropdown", async () => {
    rbacScopeMock.mockResolvedValue(nodeScope("c1", "n1"))
    orchestratorFetchMock.mockResolvedValue({ data: [CLUSTER_LESS, VM_OTHER_NODE, VM_OWNED, VM_NEIGHBOUR, NODE_EVENT, STORAGE_EVENT] })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { limit: "3" } })
    const body = await res.json()

    expect(body.data.map((r: any) => r.id)).toEqual(["ev2", "ev4", "ev5"])
    expect(rbacScopeMock).toHaveBeenCalledWith("connection.view")
  })

  it("empties the dropdown for a user granted another connection only", async () => {
    rbacScopeMock.mockResolvedValue(connectionScope("c2"))

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([])
  })
})
