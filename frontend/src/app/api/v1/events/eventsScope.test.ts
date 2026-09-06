import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../__tests__/setup/route-test"
import { vmScope } from "@/__tests__/setup/rbacScope"

// Hoist mocks so they can be referenced in vi.mock factories
const { globalFindMany, sessionFindMany, getInfraMock, getConnByIdMock, pveFetchMock, rbacScopeMock } = vi.hoisted(() => ({
  globalFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  getInfraMock: vi.fn(),
  getConnByIdMock: vi.fn().mockResolvedValue({ baseUrl: "", apiToken: "" }),
  pveFetchMock: vi.fn(),
  rbacScopeMock: vi.fn(),
}))

// Keep REAL inventoryConnectionPlan + maskingScope; only mock getTenantInfrastructureScope
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

// Session prisma (tenant-scoped client)
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { findMany: sessionFindMany } }),
  getCurrentTenantId: async () => "default",
}))

// Global prisma
vi.mock("@/lib/db/prisma", () => ({
  prisma: { connection: { findMany: globalFindMany } },
}))

// Stub getConnectionById so PVE fetches short-circuit (no baseUrl means early return)
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnByIdMock(...a),
}))

// No-op PVE fetches
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: pveFetchMock }))

// RBAC -- pass everything through
vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  getCurrentRbacInfraScope: rbacScopeMock,
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))

// Stub vdcVmids helper (not under test here)
vi.mock("@/lib/alerts/vdcVmids", () => ({
  getVdcVmidsByConnection: vi.fn().mockResolvedValue(null),
}))

// Stub task scope helper
vi.mock("@/lib/tasks/scope", () => ({
  extractTaskVmid: vi.fn((id: string) => id),
}))

beforeEach(() => {
  vi.clearAllMocks()
  globalFindMany.mockResolvedValue([])
  sessionFindMany.mockResolvedValue([])
  rbacScopeMock.mockResolvedValue(null)
  pveFetchMock.mockResolvedValue([])
})

describe("RBAC infra scope (issue #525)", () => {
  beforeEach(() => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    globalFindMany.mockResolvedValue([
      { id: "p1", name: "PVE 1", type: "pve" },
      { id: "p2", name: "PVE 2", type: "pve" },
    ])
    getConnByIdMock.mockResolvedValue({ baseUrl: "https://pve", apiToken: "t" })
    pveFetchMock.mockImplementation(async (_connection: any, path: string) => {
      if (path === "/cluster/tasks") {
        return [
          { upid: "UPID:n1:...", node: "n1", type: "qmstart", id: "100", user: "root@pam", starttime: 1000, status: "OK", pid: 1, pstart: 1 },
          { upid: "UPID:n2:...", node: "n2", type: "qmstart", id: "101", user: "root@pam", starttime: 1001, status: "OK", pid: 2, pstart: 2 },
        ]
      }
      if (path === "/cluster/resources?type=vm") return []
      if (path.startsWith("/cluster/log?")) {
        return [
          { uid: 1, time: 1000, msg: "m", node: "n1", pri: 6, tag: "t" },
          { uid: 2, time: 1001, msg: "m", node: "n2", pri: 6, tag: "t" },
        ]
      }
      return []
    })
  })

  it("queries and returns only the granted node and connection", async () => {
    rbacScopeMock.mockResolvedValue({
      fullConnections: new Set(),
      nodesByConnection: new Map([["p1", new Set(["n1"])]]),
      guestDerived: false,
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const body = await res.json()

    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data.every((event: any) => event.node === "n1" && event.connectionId === "p1")).toBe(true)
    expect(getConnByIdMock).not.toHaveBeenCalledWith("p2", expect.anything())
    expect(body.meta.connections).toBe(1)
  })

  it("returns every node on a granted connection", async () => {
    rbacScopeMock.mockResolvedValue({
      fullConnections: new Set(["p1"]),
      nodesByConnection: new Map(),
      guestDerived: false,
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const body = await res.json()

    expect(new Set(body.data.map((event: any) => event.node))).toEqual(new Set(["n1", "n2"]))
    expect(body.data.every((event: any) => event.connectionId === "p1")).toBe(true)
    expect(getConnByIdMock).not.toHaveBeenCalledWith("p2", expect.anything())
  })

  it("opens every provider connection for an admin", async () => {
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })

    expect(res.status).toBe(200)
    expect(getConnByIdMock).toHaveBeenCalledWith("p1", undefined)
    expect(getConnByIdMock).toHaveBeenCalledWith("p2", undefined)
    expect(rbacScopeMock).toHaveBeenCalledWith("connection.view")
  })

  it("returns only the directly granted guest task for a VM-only user", async () => {
    rbacScopeMock.mockResolvedValue(vmScope("p1", "n1", "100"))

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const body = await res.json()

    expect(body.data).toHaveLength(1)
    expect(body.data.every((event: any) =>
      event.connectionId === "p1" && event.category === "task" && event.entity === "100"
    )).toBe(true)
    expect(body.data.some((event: any) => event.category === "log")).toBe(false)
  })
})

describe("GET /api/v1/events scope routing", () => {
  it("provider: uses the GLOBAL prisma client and does not call session client", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    expect(globalFindMany).toHaveBeenCalled()
    expect(sessionFindMany).not.toHaveBeenCalled()
  })

  it("msp: uses the SESSION (tenant-scoped) prisma client and does not call global client", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    expect(sessionFindMany).toHaveBeenCalled()
    expect(globalFindMany).not.toHaveBeenCalled()
  })

  it("iaas: uses the GLOBAL client and connections are filtered to vDC connection ids", async () => {
    const vdcScope = {
      connectionIds: new Set(["p1"]),
      pbsConnectionIds: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map<string, Set<string>>(),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    // Return two PVE connections; only p1 is in the vDC scope
    globalFindMany.mockResolvedValue([
      { id: "p1", name: "PVE 1", type: "pve" },
      { id: "p2", name: "PVE 2", type: "pve" },
    ])

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    // Global client used, session client not called
    expect(globalFindMany).toHaveBeenCalled()
    expect(sessionFindMany).not.toHaveBeenCalled()

    // The id filter must include only p1 (the vDC-bound connection)
    const whereArg = globalFindMany.mock.calls[0][0]?.where
    expect(whereArg?.id?.in).toEqual(expect.arrayContaining(["p1"]))
    expect(whereArg?.id?.in).not.toContain("p2")
  })

  it("provider: passes each connection's own tenantId to getConnectionById", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    globalFindMany.mockResolvedValue([
      { id: "conn-msp-1", name: "MSP PVE", type: "pve", tenantId: "msp-1" },
    ])

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    expect(getConnByIdMock).toHaveBeenCalledWith("conn-msp-1", "msp-1")
  })
})
