import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

// Hoist mocks so they are available in vi.mock factories
const {
  getInfraMock,
  getConnectionByIdMock,
  checkPermissionMock,
  pveFetchMock,
  globalUpsertMock,
  globalDeleteManyMock,
  globalFindManyMock,
  sessionUpsertMock,
  sessionDeleteManyMock,
  sessionFindManyMock,
} = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  pveFetchMock: vi.fn(),
  globalUpsertMock: vi.fn().mockResolvedValue({}),
  globalDeleteManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  globalFindManyMock: vi.fn().mockResolvedValue([]),
  sessionUpsertMock: vi.fn().mockResolvedValue({}),
  sessionDeleteManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  sessionFindManyMock: vi.fn().mockResolvedValue([]),
}))

// Keep REAL maskingScope; only mock the resolver
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: getInfraMock,
}))

// Mutable variable: getCurrentTenantId returns this (the session tenant)
let currentTenantId = "default"

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({
    managedHost: {
      upsert: sessionUpsertMock,
      deleteMany: sessionDeleteManyMock,
      findMany: sessionFindManyMock,
    },
  }),
  getCurrentTenantId: async () => currentTenantId,
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    managedHost: {
      upsert: globalUpsertMock,
      deleteMany: globalDeleteManyMock,
      findMany: globalFindManyMock,
    },
  },
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { NODE_VIEW: "node.view", CONNECTION_VIEW: "connection.view" },
}))

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: pveFetchMock }))
vi.mock("@/lib/proxmox/resolveManagementIp", () => ({
  resolveManagementIp: () => "10.0.0.1",
}))
vi.mock("@/lib/proxmox/urlUtils", () => ({
  extractHostFromUrl: (u: string) => new URL(u).hostname,
  extractPortFromUrl: (u: string) => Number(new URL(u).port || 8006),
}))
vi.mock("@/lib/cache/nodeIpCache", () => ({ setNodeIps: vi.fn() }))

import { GET as nodesGET } from "./route"

// The nodes route accepts `Promise<{id}> | {id}` for params; align with callRoute's contract
const GET = nodesGET as Parameters<typeof callRoute>[0]

const MSP_CONN = {
  id: "c-msp",
  baseUrl: "https://10.0.0.1:8006",
  apiToken: "tok",
  tenantId: "msp-1",
}

const POOL_CONN = {
  id: "c-pool",
  baseUrl: "https://10.0.0.1:8006",
  apiToken: "tok",
  tenantId: "default",
}

const nodesCacheKey = "__proxcenter_nodes_response_cache__"

function mockPveNodes() {
  pveFetchMock
    // /nodes
    .mockResolvedValueOnce([{ node: "pve1", status: "online" }])
    // /cluster/resources?type=node
    .mockResolvedValueOnce([])
    // /nodes/pve1/network
    .mockResolvedValueOnce([{ iface: "vmbr0", type: "bridge" }])
    // /nodes/pve1/status
    .mockResolvedValueOnce({ memory: { used: 1, total: 2 } })
}

beforeEach(() => {
  vi.clearAllMocks()
  currentTenantId = "default"
  checkPermissionMock.mockResolvedValue(null)
  getInfraMock.mockResolvedValue({ kind: "provider" })
  getConnectionByIdMock.mockResolvedValue(MSP_CONN)
  globalUpsertMock.mockResolvedValue({})
  globalDeleteManyMock.mockResolvedValue({ count: 0 })
  globalFindManyMock.mockResolvedValue([])
  sessionUpsertMock.mockResolvedValue({})
  sessionDeleteManyMock.mockResolvedValue({ count: 0 })
  sessionFindManyMock.mockResolvedValue([])
  delete (globalThis as any)[nodesCacheKey]
})

describe("GET /api/v1/connections/[id]/nodes (cross-tenant ManagedHost handling)", () => {
  it("provider viewing an MSP-owned connection gets the node list", async () => {
    mockPveNodes()

    const res = await callRoute(GET, { params: { id: "c-msp" } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toHaveLength(1)
  })

  it("provider on an MSP-owned connection persists ManagedHost under the owner's tenant", async () => {
    mockPveNodes()

    await callRoute(GET, { params: { id: "c-msp" } })

    expect(globalUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ connectionId: "c-msp", tenantId: "msp-1" }),
      })
    )
    expect(sessionUpsertMock).not.toHaveBeenCalled()
  })

  it("provider on a pool connection keeps the session-scoped writes (today's behavior)", async () => {
    getConnectionByIdMock.mockResolvedValue(POOL_CONN)
    mockPveNodes()

    await callRoute(GET, { params: { id: "c-pool" } })

    expect(sessionUpsertMock).toHaveBeenCalled()
    expect(globalUpsertMock).not.toHaveBeenCalled()
  })

  it("an MSP tenant on its own connection keeps the session-scoped writes", async () => {
    currentTenantId = "msp-1"
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c-msp"]) })
    mockPveNodes()

    const res = await callRoute(GET, { params: { id: "c-msp" } })

    expect(res.status).toBe(200)
    expect(sessionUpsertMock).toHaveBeenCalled()
    expect(globalUpsertMock).not.toHaveBeenCalled()
  })

  it("a fleet-view cache entry is not served to a scoped default-tenant caller", async () => {
    // Authorized NOC caller fills the 30s response cache for the MSP connection
    mockPveNodes()
    const first = await callRoute(GET, { params: { id: "c-msp" } })
    expect(first.status).toBe(200)

    // A scoped default-tenant caller (connection.view denied) must miss that
    // cache entry; the data layer then rejects the cross-tenant load.
    checkPermissionMock.mockImplementation(async (_perm: string, type?: string) =>
      type === "connection"
        ? new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })
        : null
    )
    getConnectionByIdMock.mockRejectedValue(new Error("Connection not found: c-msp"))

    await expect(callRoute(GET, { params: { id: "c-msp" } })).rejects.toThrow(
      /Connection not found/
    )
  })
})
