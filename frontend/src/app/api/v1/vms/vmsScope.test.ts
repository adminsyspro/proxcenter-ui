import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../__tests__/setup/route-test"

// Hoist mocks so they can be referenced in vi.mock factories
const { globalFindMany, sessionFindMany, getInfraMock, getConnByIdMock } = vi.hoisted(() => ({
  globalFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  getInfraMock: vi.fn(),
  getConnByIdMock: vi.fn().mockResolvedValue({ baseUrl: "", apiToken: "" }),
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
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn().mockResolvedValue([]) }))

// RBAC -- pass everything through
vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  getRBACContext: vi.fn().mockResolvedValue(null),
  filterVmsByPermission: (_uid: any, list: any[]) => Promise.resolve(list),
  PERMISSIONS: { VM_VIEW: "vm.view" },
}))

// Stub format utils
vi.mock("@/utils/format", () => ({
  formatBytes: (n: number) => `${n}B`,
  formatUptime: (s: number) => `${s}s`,
}))

beforeEach(() => {
  vi.clearAllMocks()
  globalFindMany.mockResolvedValue([])
  sessionFindMany.mockResolvedValue([])
})

describe("GET /api/v1/vms scope routing", () => {
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
      { id: "p1", name: "PVE 1" },
      { id: "p2", name: "PVE 2" },
    ])

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    // Global client used, session client not called
    expect(globalFindMany).toHaveBeenCalled()
    expect(sessionFindMany).not.toHaveBeenCalled()

    // The response should not contain any VMs from connection p2
    // (connections returned [] from pveFetch so vms will be empty, but the
    // key assertion is that p2 was never passed to getConnectionById)
    const calledIds = getConnByIdMock.mock.calls.map((c: any[]) => c[0])
    expect(calledIds).not.toContain("p2")
  })

  it("provider: passes each connection's own tenantId to getConnectionById", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    globalFindMany.mockResolvedValue([
      { id: "conn-msp-1", name: "MSP PVE", tenantId: "msp-1" },
    ])

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    expect(getConnByIdMock).toHaveBeenCalledWith("conn-msp-1", "msp-1")
  })
})
