import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../__tests__/setup/route-test"

// Hoist mocks so they can be referenced in vi.mock factories
const { globalFindMany, sessionFindMany, getInfraMock, mockGetServerSession, mockListSnapshotsInNamespace, mockPbsFetch } = vi.hoisted(() => ({
  globalFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  getInfraMock: vi.fn(),
  mockGetServerSession: vi.fn(),
  mockListSnapshotsInNamespace: vi.fn(),
  mockPbsFetch: vi.fn(),
}))

// Keep REAL inventoryConnectionPlan + maskingScope; only mock getTenantInfrastructureScope
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

// Session prisma (tenant-scoped client) -- also stubs alert table used by syncAlertsToDatabase
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({
    connection: { findMany: sessionFindMany },
    alert: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
  }),
  getCurrentTenantId: async () => "default",
}))

// Global prisma -- also stubs alert table used by syncAlertsToDatabase
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findMany: globalFindMany },
    alert: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
  },
}))

// Auth session -- use hoisted mock so we can change tenantId per test
vi.mock("next-auth", () => ({
  getServerSession: mockGetServerSession,
}))

// Stub getConnectionById so PVE/PBS fetches short-circuit (no baseUrl means the handler returns null early)
const { getConnByIdMock, getPbsConnByIdMock } = vi.hoisted(() => ({
  getConnByIdMock: vi.fn().mockResolvedValue({ baseUrl: "", apiToken: "" }),
  getPbsConnByIdMock: vi.fn().mockResolvedValue({ baseUrl: "", apiToken: "" }),
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnByIdMock(...a),
  getPbsConnectionById: (...a: any[]) => getPbsConnByIdMock(...a),
}))

// No-op PVE fetch
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn().mockResolvedValue([]) }))
// PBS fetch — controlled per-test via mockPbsFetch
vi.mock("@/lib/proxmox/pbs-client", () => ({ pbsFetch: (...a: any[]) => mockPbsFetch(...a) }))
// PBS namespace helper — controlled per-test via mockListSnapshotsInNamespace
vi.mock("@/lib/proxmox/pbsNamespace", () => ({
  listSnapshotsInNamespace: (...a: any[]) => mockListSnapshotsInNamespace(...a),
}))

// No stored threshold settings
vi.mock("@/lib/db/settings", () => ({ getSetting: vi.fn().mockResolvedValue(null) }))

// RBAC -- pass everything through
vi.mock("@/lib/rbac", () => ({
  filterVmsByPermission: (_uid: any, list: any[]) => Promise.resolve(list),
  filterNodesByPermission: (_uid: any, list: any[]) => Promise.resolve(list),
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: {},
}))

// Stub orchestrator + alert helpers
vi.mock("@/lib/orchestrator/client", () => ({
  alertsApi: { getAlerts: vi.fn().mockRejectedValue(new Error("no orch")) },
}))
vi.mock("@/lib/alerts/silenceFilter", () => ({
  loadActiveSilenceFingerprints: vi.fn().mockResolvedValue(new Set()),
}))
vi.mock("@/lib/alerts/dashboardAlertMerge", () => ({
  mergeAndFilterDashboardAlerts: vi.fn().mockReturnValue([]),
}))
vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: vi.fn().mockReturnValue(null) }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
// Stub vdc/scope so the current code path (getVdcScope) does not blow up before we replace it
vi.mock("@/lib/vdc/scope", () => ({
  getVdcScope: vi.fn().mockResolvedValue(null),
  applyVdcFilter: vi.fn((items: any[]) => items),
}))

beforeEach(() => {
  vi.clearAllMocks()
  // Reset finders to return empty lists
  globalFindMany.mockResolvedValue([])
  sessionFindMany.mockResolvedValue([])
  // Default session: provider tenant
  mockGetServerSession.mockResolvedValue({ user: { id: "u1", tenantId: "default" } })
  // Default PBS fetch: return empty arrays (no-op)
  mockPbsFetch.mockResolvedValue([])
  // Default namespace snapshot fetch: return empty
  mockListSnapshotsInNamespace.mockResolvedValue([])
})

describe("GET /api/v1/dashboard scope routing", () => {
  it("provider: uses the GLOBAL prisma client and does not call session client", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    expect(globalFindMany).toHaveBeenCalled()
    expect(sessionFindMany).not.toHaveBeenCalled()
  })

  it("provider: passes each connection's own tenantId to getConnectionById and getPbsConnectionById", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    // Return one PVE connection owned by an MSP tenant and one PBS connection owned by the same
    globalFindMany.mockResolvedValue([
      { id: "conn-msp-1", name: "MSP PVE", type: "pve", hasCeph: false, tenantId: "msp-1" },
      { id: "pbs-msp-1", name: "MSP PBS", type: "pbs", hasCeph: false, tenantId: "msp-1" },
    ])

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    expect(getConnByIdMock).toHaveBeenCalledWith("conn-msp-1", "msp-1")
    expect(getPbsConnByIdMock).toHaveBeenCalledWith("pbs-msp-1", "msp-1")
  })

  it("msp: uses the SESSION (tenant-scoped) prisma client and does not call global client", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", tenantId: "msp-1" } })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    expect(sessionFindMany).toHaveBeenCalled()
    expect(globalFindMany).not.toHaveBeenCalled()
  })

  it("iaas: uses GLOBAL client and PVE connections are filtered to vDC ids", async () => {
    const vdcScope = {
      connectionIds: new Set(["p1"]),
      pbsConnectionIds: new Set(["pbs-allowed"]),
      nodesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map<string, Set<string>>(),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    // Return two PVE connections (only p1 is in-scope) plus two PBS connections
    // (pbs-allowed is in-scope, pbs-other must be excluded for the tenant)
    globalFindMany.mockResolvedValue([
      { id: "p1", name: "PVE 1", type: "pve", hasCeph: false, tenantId: "default" },
      { id: "p2", name: "PVE 2", type: "pve", hasCeph: false, tenantId: "default" },
      { id: "pbs-allowed", name: "PBS Allowed", type: "pbs", hasCeph: false, tenantId: "default" },
      { id: "pbs-other", name: "PBS Other", type: "pbs", hasCeph: false, tenantId: "default" },
    ])

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    // Global client used, session client not called
    expect(globalFindMany).toHaveBeenCalled()
    expect(sessionFindMany).not.toHaveBeenCalled()

    // p2 must not appear in the clusters list
    const body = await res.clone().json()
    const clusterIds = (body.data?.clusters ?? []).map((c: any) => c.id)
    expect(clusterIds).not.toContain("p2")

    // PBS filter: only the in-scope PBS connection must be opened
    expect(getPbsConnByIdMock).toHaveBeenCalledWith("pbs-allowed", "default")
    // The out-of-scope PBS must never be opened (cross-tenant data leak guard)
    expect(getPbsConnByIdMock).not.toHaveBeenCalledWith("pbs-other", expect.anything())
  })

  it("provider: out-of-pool PBS connections are loaded (no PBS filter for provider)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    // Provider sees all PBS servers regardless of tenant ownership
    globalFindMany.mockResolvedValue([
      { id: "pbs-tenant-a", name: "PBS Tenant A", type: "pbs", hasCeph: false, tenantId: "tenant-a" },
      { id: "pbs-tenant-b", name: "PBS Tenant B", type: "pbs", hasCeph: false, tenantId: "tenant-b" },
    ])

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    // Both PBS connections must be opened for the provider (full NOC visibility)
    expect(getPbsConnByIdMock).toHaveBeenCalledWith("pbs-tenant-a", "tenant-a")
    expect(getPbsConnByIdMock).toHaveBeenCalledWith("pbs-tenant-b", "tenant-b")
  })

  it("provider: uses bulk /snapshots endpoint and does NOT use listSnapshotsInNamespace", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    globalFindMany.mockResolvedValue([
      { id: "pbs-1", name: "PBS Main", type: "pbs", hasCeph: false, tenantId: "default" },
    ])
    getPbsConnByIdMock.mockResolvedValue({ baseUrl: "https://pbs.example.com", apiToken: "tok" })

    // PBS /admin/datastore returns two stores
    const now = Math.floor(Date.now() / 1000)
    mockPbsFetch.mockImplementation(async (_conn: any, path: string) => {
      if (path === "/admin/datastore") return [{ store: "store1" }, { store: "store2" }]
      if (path.includes("/status")) return { total: 1000, used: 500, avail: 500 }
      if (path.includes("/snapshots")) return [{ "backup-time": now - 100, "backup-type": "vm" }]
      if (path.includes("/tasks")) return []
      return []
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    // Provider must NOT use namespace-scoped snapshots
    expect(mockListSnapshotsInNamespace).not.toHaveBeenCalled()

    // The bulk /snapshots endpoint must have been called for both stores
    const snapshotCalls = mockPbsFetch.mock.calls.filter(([, p]: [any, string]) =>
      typeof p === "string" && p.includes("/snapshots")
    )
    expect(snapshotCalls.length).toBeGreaterThanOrEqual(2)

    // Provider must fetch /status for each datastore and report real capacity (not zeros).
    const statusCalls = mockPbsFetch.mock.calls.filter(([, p]: [any, string]) =>
      typeof p === "string" && p.includes("/status")
    )
    expect(statusCalls.length).toBeGreaterThanOrEqual(2)

    const body = await res.clone().json()
    const pbsData = body.data?.pbs
    // Real total/used values from the mock (1000 * 2 stores = 2000)
    expect(pbsData?.totalSize).toBe(2000)
    expect(pbsData?.totalUsed).toBe(1000)
    expect(pbsData?.usagePct).toBe(50)
  })

  it("iaas: PBS aggregation is namespace-scoped (only store1/tenant-a, not store2)", async () => {
    // IaaS tenant whose vDC grants access to store1 / namespace tenant-a only.
    const pbsNamespacesByConnection = new Map([
      ["pbs-shared", [{ datastore: "store1", namespace: "tenant-a" }]],
    ])
    const vdcScope = {
      connectionIds: new Set<string>(),
      pbsConnectionIds: new Set(["pbs-shared"]),
      nodesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map<string, Set<string>>(),
      storagesByConnection: new Map<string, Set<string>>(),
      pbsNamespacesByConnection,
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", tenantId: "iaas-tenant" } })

    globalFindMany.mockResolvedValue([
      { id: "pbs-shared", name: "PBS Shared", type: "pbs", hasCeph: false, tenantId: "default" },
    ])
    getPbsConnByIdMock.mockResolvedValue({ baseUrl: "https://pbs.example.com", apiToken: "tok" })

    // PBS /admin/datastore returns two stores; only store1 belongs to the tenant
    const now = Math.floor(Date.now() / 1000)
    mockPbsFetch.mockImplementation(async (_conn: any, path: string) => {
      if (path === "/admin/datastore") return [{ store: "store1" }, { store: "store2" }]
      if (path.includes("store1") && path.includes("/status")) return { total: 2000, used: 800, avail: 1200 }
      if (path.includes("store2") && path.includes("/status")) return { total: 5000, used: 3000, avail: 2000 }
      // Tasks must NOT be called for IaaS
      if (path.includes("/tasks")) throw new Error("tasks must not be fetched for IaaS")
      return []
    })

    // listSnapshotsInNamespace returns 2 recent snapshots for store1/tenant-a
    mockListSnapshotsInNamespace.mockImplementation(
      async (_conn: any, datastore: string, namespace: string) => {
        if (datastore === "store1" && namespace === "tenant-a") {
          return [
            { "backup-time": now - 3600, "backup-type": "vm" },
            { "backup-time": now - 7200, "backup-type": "ct" },
          ]
        }
        return []
      }
    )

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    // listSnapshotsInNamespace called for store1/tenant-a and NOT for store2
    expect(mockListSnapshotsInNamespace).toHaveBeenCalledWith(
      expect.anything(), "store1", "tenant-a"
    )
    expect(mockListSnapshotsInNamespace).not.toHaveBeenCalledWith(
      expect.anything(), "store2", expect.anything()
    )

    // The bulk /snapshots endpoint must NOT have been called (namespace path used instead)
    const bulkSnapshotCalls = mockPbsFetch.mock.calls.filter(([, p]: [any, string]) =>
      typeof p === "string" && p.includes("/snapshots")
    )
    expect(bulkSnapshotCalls).toHaveLength(0)

    const body = await res.clone().json()
    const pbsData = body.data?.pbs

    // Only store1 processed: datastoreCount = 1
    expect(pbsData?.datastores).toBe(1)

    // Backup count reflects the 2 namespace snapshots (no task-based additions)
    expect(pbsData?.backups24h?.total).toBe(2)
    expect(pbsData?.backups24h?.ok).toBe(2)
    expect(pbsData?.backups24h?.error).toBe(0)

    // No recent task errors for IaaS
    expect(pbsData?.recentErrors).toHaveLength(0)

    // IaaS must NOT expose datastore-wide capacity (cross-tenant storage leak guard).
    // The /status endpoint must never be called for IaaS — capacity is zeroed out.
    const statusCalls = mockPbsFetch.mock.calls.filter(([, p]: [any, string]) =>
      typeof p === "string" && p.includes("/status")
    )
    expect(statusCalls).toHaveLength(0)

    // Aggregated PBS capacity must be zero for IaaS (no shared capacity exposed).
    expect(pbsData?.totalSize).toBe(0)
    expect(pbsData?.totalUsed).toBe(0)
    expect(pbsData?.usagePct).toBe(0)

    // Per-datastore capacity must also be zeroed.
    const ds = (pbsData?.serverDetails ?? [])[0]
    expect(ds?.totalSize).toBe(0)
    expect(ds?.totalUsed).toBe(0)
  })

  it("iaas: PBS connection with no assigned namespace is skipped entirely", async () => {
    // IaaS tenant that has pbs-shared in pbsConnectionIds but no namespace entries
    const pbsNamespacesByConnection = new Map<string, Array<{ datastore: string; namespace: string }>>()
    const vdcScope = {
      connectionIds: new Set<string>(),
      pbsConnectionIds: new Set(["pbs-shared"]),
      nodesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map<string, Set<string>>(),
      storagesByConnection: new Map<string, Set<string>>(),
      pbsNamespacesByConnection,
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", tenantId: "iaas-tenant-2" } })

    globalFindMany.mockResolvedValue([
      { id: "pbs-shared", name: "PBS Shared", type: "pbs", hasCeph: false, tenantId: "default" },
    ])
    getPbsConnByIdMock.mockResolvedValue({ baseUrl: "https://pbs.example.com", apiToken: "tok" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    // No datastores or snapshots should be fetched if the tenant has no namespaces on this PBS
    expect(mockPbsFetch).not.toHaveBeenCalled()
    expect(mockListSnapshotsInNamespace).not.toHaveBeenCalled()

    const body = await res.clone().json()
    expect(body.data?.pbs?.datastores).toBe(0)
  })
})
