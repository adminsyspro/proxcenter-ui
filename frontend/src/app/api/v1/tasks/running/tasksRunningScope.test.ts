import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../../__tests__/setup/route-test"

// Hoist mocks so vi.mock factories can reference them
const { getInfraMock, pveFetchMock, getConnectionByIdMock, getVdcVmidsMock, tenantConnectionIdsMock } =
  vi.hoisted(() => ({
    getInfraMock: vi.fn(),
    pveFetchMock: vi.fn(),
    getConnectionByIdMock: vi.fn(),
    getVdcVmidsMock: vi.fn(),
    tenantConnectionIdsMock: vi.fn(),
  }))

// Keep real maskingScope; only mock getTenantInfrastructureScope
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => "t1",
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a),
}))

const { prismFindManyMock } = vi.hoisted(() => ({
  prismFindManyMock: vi.fn().mockResolvedValue([
    { id: "c1", name: "PVE-1", type: "pve", tenantId: "default" },
  ]),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: {
      findMany: (...a: any[]) => prismFindManyMock(...a),
    },
  },
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))

vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))

vi.mock("@/lib/alerts/vdcVmids", () => ({
  getVdcVmidsByConnection: (...a: any[]) => getVdcVmidsMock(...a),
}))

vi.mock("@/lib/tasks/scope", () => ({
  extractTaskVmid: (id: string | undefined) => (id ? parseInt(id, 10) || null : null),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))

// Stub old vdc/scope import so the dynamic import path in old code doesn't blow up
vi.mock("@/lib/vdc/scope", () => ({
  getVdcScope: vi.fn().mockResolvedValue(null),
}))

const RUNNING_TASK = {
  upid: "UPID:node1:001:002:003:qmstart:100:root@pam:",
  node: "node1",
  pid: 1,
  pstart: 1,
  starttime: Math.floor(Date.now() / 1000) - 10,
  type: "qmstart",
  id: "100",
  user: "root@pam",
  // no endtime, no status -> running
}

beforeEach(() => {
  vi.clearAllMocks()
  tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))
  getConnectionByIdMock.mockResolvedValue({ baseUrl: "http://pve", apiToken: "tok" })
  pveFetchMock.mockResolvedValue([RUNNING_TASK])
  getVdcVmidsMock.mockResolvedValue(new Map())
})

describe("GET /api/v1/tasks/running scope routing", () => {
  it("provider: returns the task without calling getVdcVmidsByConnection", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    // Task must not be dropped
    expect(body.data).toHaveLength(1)
    expect(body.data[0].node).toBe("node1")
    // Pool-masking helper must not be called for provider (maskingScope returns null)
    expect(getVdcVmidsMock).not.toHaveBeenCalled()
  })

  it("msp: returns the task on owned connections without calling getVdcVmidsByConnection", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data).toHaveLength(1)
    // MSP sees full cluster, no pool masking
    expect(getVdcVmidsMock).not.toHaveBeenCalled()
  })

  it("iaas: applies pool masking via getVdcVmidsByConnection; drops tasks whose vmid is not in scope", async () => {
    const vdcScope = {
      connectionIds: new Set(["c1"]),
      pbsConnectionIds: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map<string, Set<string>>(),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })
    // Allowed vmids for c1 = empty set -> vmid 100 not in scope -> task dropped
    getVdcVmidsMock.mockResolvedValue(new Map([["c1", new Set<number>()]]))

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    // vmid 100 is not in the allowed set, so it must be filtered out
    expect(body.data).toHaveLength(0)
    expect(getVdcVmidsMock).toHaveBeenCalled()
  })

  it("iaas: passes tasks whose vmid IS in the allowed pool set", async () => {
    const vdcScope = {
      connectionIds: new Set(["c1"]),
      pbsConnectionIds: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map<string, Set<string>>(),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })
    // vmid 100 is allowed
    getVdcVmidsMock.mockResolvedValue(new Map([["c1", new Set<number>([100])]]))

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data).toHaveLength(1)
  })

  it("provider: passes each connection's own tenantId to getConnectionById", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    // Override the prisma mock to return an MSP-owned connection
    prismFindManyMock.mockResolvedValue([
      { id: "conn-msp-1", name: "MSP PVE", type: "pve", tenantId: "msp-1" },
    ])
    tenantConnectionIdsMock.mockResolvedValue(new Set(["conn-msp-1"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    expect(getConnectionByIdMock).toHaveBeenCalledWith("conn-msp-1", "msp-1")
  })
})
