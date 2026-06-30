/**
 * Scope-routing tests for GET /api/v1/inventory.
 *
 * Strategy: mock @/lib/cache/inventoryCache to return a pre-built "fresh"
 * payload (two clusters, one PBS server per cluster's connection). This avoids
 * any PVE/PBS HTTP -- the fresh-cache path is the normal production code path,
 * so no injectable seam is needed beyond the existing cache module.
 *
 * Mock @/lib/rbac for getRBACContext, getRbacInfraScope, and the helpers that
 * the route chains. Keep real maskingScope (from @/lib/tenant/infraScope) so
 * the vDC composition is exercised with a real function.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { NextRequest } from "next/server"
import { readJson } from "../../../../__tests__/setup/route-test"

/** Minimal callRoute for GET handlers that use request.nextUrl.searchParams. */
async function callGet(handler: (req: NextRequest, ctx: any) => Promise<Response>) {
  const req = new NextRequest("http://test.local/api/v1/inventory")
  return handler(req, { params: Promise.resolve({}) })
}

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------
const {
  getInfraMock,
  getInventoryFromCacheMock,
  getRBACContextMock,
  getRbacInfraScopeMock,
  checkPermissionMock,
  filterVmsByPermissionMock,
} = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  getInventoryFromCacheMock: vi.fn(),
  getRBACContextMock: vi.fn(),
  getRbacInfraScopeMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  filterVmsByPermissionMock: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Keep real maskingScope; only stub getTenantInfrastructureScope
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => "t1",
  getSessionPrisma: async () => ({}),
}))

// Stub the inventory cache so the route takes the "fresh" path without any
// PVE HTTP. getInventoryFromCacheMock is configured per-test.
vi.mock("@/lib/cache/inventoryCache", () => ({
  getInventoryFromCache: (...a: any[]) => getInventoryFromCacheMock(...a),
  setCachedInventory: vi.fn(),
  getInflightFetch: vi.fn().mockReturnValue(null),
  setInflightFetch: vi.fn(),
}))

vi.mock("@/lib/rbac", async (orig) => {
  // Keep real applyRbacInfraFilter, isConnectionVisible, applyVdcFilter
  // (they are pure helpers, no side-effects). Only stub the async ones.
  const real = await orig<typeof import("@/lib/rbac")>()
  return {
    ...real,
    checkPermission: (...a: any[]) => checkPermissionMock(...a),
    getRBACContext: (...a: any[]) => getRBACContextMock(...a),
    getRbacInfraScope: (...a: any[]) => getRbacInfraScopeMock(...a),
    filterVmsByPermission: (...a: any[]) => filterVmsByPermissionMock(...a),
  }
})

vi.mock("@/lib/demo/demo-api", () => ({
  demoResponse: vi.fn().mockReturnValue(null),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

// ---------------------------------------------------------------------------
// Test fixture: two PVE clusters + one PBS server
// ---------------------------------------------------------------------------

/**
 * Raw inventory with:
 *   connA: nodes [n1 (online), n2 (online)], each with one guest
 *   connB: nodes [m1 (online)], one guest
 *   pbsConnA: PBS server whose id matches connA (same connection id)
 */
function makeRawInventory() {
  return {
    clusters: [
      {
        id: "connA",
        name: "Cluster A",
        type: "pve",
        isCluster: true,
        status: "online" as const,
        nodes: [
          {
            node: "n1",
            status: "online",
            guests: [{ vmid: 101, type: "qemu", status: "running", name: "vm101", node: "n1" }],
          },
          {
            node: "n2",
            status: "online",
            guests: [{ vmid: 102, type: "qemu", status: "stopped", name: "vm102", node: "n2" }],
          },
        ],
      },
      {
        id: "connB",
        name: "Cluster B",
        type: "pve",
        isCluster: false,
        status: "online" as const,
        nodes: [
          {
            node: "m1",
            status: "online",
            guests: [{ vmid: 201, type: "lxc", status: "running", name: "ct201", node: "m1" }],
          },
        ],
      },
    ],
    pbsServers: [
      {
        id: "pbsConnA",
        name: "PBS A",
        type: "pbs" as const,
        status: "online" as const,
        datastores: [],
        stats: { totalSize: 0, totalUsed: 0, datastoreCount: 2, backupCount: 5 },
      },
      {
        id: "pbsConnB",
        name: "PBS B",
        type: "pbs" as const,
        status: "online" as const,
        datastores: [],
        stats: { totalSize: 0, totalUsed: 0, datastoreCount: 1, backupCount: 3 },
      },
    ],
    externalHypervisors: [],
    storages: [],
    stats: {
      totalClusters: 2,
      totalNodes: 3,
      totalGuests: 3,
      onlineNodes: 3,
      runningGuests: 2,
      totalPbsServers: 2,
      totalDatastores: 3,
      totalBackups: 8,
    },
  }
}

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // Default: permission check passes
  checkPermissionMock.mockResolvedValue(null)
  // Default: provider infra scope (no vDC mask)
  getInfraMock.mockResolvedValue({ kind: "provider" })
  // Default: fresh cache hit with the two-cluster fixture
  getInventoryFromCacheMock.mockReturnValue({ status: "fresh", data: makeRawInventory() })
  // Default: filterVmsByPermission passes all guests through (returns them as-is)
  filterVmsByPermissionMock.mockImplementation((_userId: any, vms: any[]) => Promise.resolve(vms))
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/inventory RBAC infra-scope pruning", () => {

  it("node-scoped user: tree shows only the granted connection and the granted node", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u1", isAdmin: false, tenantId: "default" })
    // User has node scope on connA/n1 only
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["connA", new Set(["n1"])]]),
    })

    const { GET } = await import("./route")
    const res = await callGet(GET)
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    const data = body?.data ?? body

    // Only connA should appear
    expect(data.clusters.map((c: any) => c.id)).toEqual(["connA"])
    // Within connA, only n1 (n2 is pruned)
    expect(data.clusters[0].nodes.map((n: any) => n.node)).toEqual(["n1"])
    // connB is gone -- PBS of connB also gone (if it were scoped to connA only)
    // connA has 1 running guest on n1
    expect(data.stats.totalNodes).toBe(1)
    expect(data.stats.totalGuests).toBe(1)
    expect(data.stats.runningGuests).toBe(1)
  })

  it("admin (isAdmin: true): tree unchanged and getRbacInfraScope NOT called", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "admin", isAdmin: true, tenantId: "default" })

    const { GET } = await import("./route")
    const res = await callGet(GET)
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    const data = body?.data ?? body

    // Both clusters present
    expect(data.clusters.map((c: any) => c.id).sort()).toEqual(["connA", "connB"])
    // getRbacInfraScope must never be consulted for admins
    expect(getRbacInfraScopeMock).not.toHaveBeenCalled()
    expect(data.stats.totalNodes).toBe(3)
  })

  it("connection-scoped user (fullConnections): whole connection visible, other connection absent", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "default" })
    // User has full connection scope on connB only
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(["connB"]),
      nodesByConnection: new Map<string, Set<string>>(),
    })

    const { GET } = await import("./route")
    const res = await callGet(GET)
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    const data = body?.data ?? body

    // Only connB
    expect(data.clusters.map((c: any) => c.id)).toEqual(["connB"])
    // All of connB's nodes present (full connection grant)
    expect(data.clusters[0].nodes.map((n: any) => n.node)).toEqual(["m1"])
    expect(data.stats.totalNodes).toBe(1)
  })

  it("PBS servers are pruned by the same RBAC scope (node-scoped user sees no PBS)", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u1", isAdmin: false, tenantId: "default" })
    // Node scope on connA/n1 only -- pbsConnA and pbsConnB are different connection ids
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["connA", new Set(["n1"])]]),
    })

    const { GET } = await import("./route")
    const res = await callGet(GET)
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    const data = body?.data ?? body

    // pbsConnA and pbsConnB are not in the RBAC scope (connA/n1 node scope does
    // NOT grant a PBS connection with id "pbsConnA" -- different id)
    expect(data.pbsServers).toHaveLength(0)
    expect(data.stats.totalPbsServers).toBe(0)
    expect(data.stats.totalDatastores).toBe(0)
    expect(data.stats.totalBackups).toBe(0)
  })

  it("admin: PBS servers all present", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "admin", isAdmin: true, tenantId: "default" })

    const { GET } = await import("./route")
    const res = await callGet(GET)
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    const data = body?.data ?? body

    expect(data.pbsServers).toHaveLength(2)
    expect(data.stats.totalPbsServers).toBe(2)
    expect(data.stats.totalDatastores).toBe(3)
    expect(data.stats.totalBackups).toBe(8)
  })

  it("null RBAC context (unauthenticated): guest filter and node prune are skipped (provider scope)", async () => {
    // checkPermission passes but no RBAC context
    getRBACContextMock.mockResolvedValue(null)

    const { GET } = await import("./route")
    const res = await callGet(GET)
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    const data = body?.data ?? body

    // Full tree visible (no pruning on unauthenticated)
    expect(data.clusters).toHaveLength(2)
    expect(getRbacInfraScopeMock).not.toHaveBeenCalled()
  })

  it("PBS: connection-scoped user retains PBS whose id is in fullConnections, excludes others", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u3", isAdmin: false, tenantId: "default" })
    // User has full access to connA and pbsConnA, but NOT pbsConnB
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(["connA", "pbsConnA"]),
      nodesByConnection: new Map<string, Set<string>>(),
    })

    const { GET } = await import("./route")
    const res = await callGet(GET)
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    const data = body?.data ?? body

    // pbsConnA is granted, pbsConnB is not
    expect(data.pbsServers.map((p: any) => p.id)).toEqual(["pbsConnA"])
    expect(data.pbsServers).toHaveLength(1)
    expect(data.stats.totalPbsServers).toBe(1)
    // PBS A has datastoreCount=2, backupCount=5
    expect(data.stats.totalDatastores).toBe(2)
    expect(data.stats.totalBackups).toBe(5)
  })

  it("externalHypervisors: scoped user sees only granted connections, admin sees all", async () => {
    // Extend the fixture with two external hypervisors
    const rawWithExt = {
      ...makeRawInventory(),
      externalHypervisors: [
        { id: "extA", name: "vCenter A", type: "vmware" },
        { id: "extB", name: "ESXi B", type: "vmware" },
      ],
    }
    getInventoryFromCacheMock.mockReturnValue({ status: "fresh", data: rawWithExt })

    // First: scoped user with only extA in fullConnections
    getRBACContextMock.mockResolvedValue({ userId: "u4", isAdmin: false, tenantId: "default" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(["extA"]),
      nodesByConnection: new Map<string, Set<string>>(),
    })

    const { GET } = await import("./route")
    const scopedRes = await callGet(GET)
    expect(scopedRes.status).toBe(200)
    const scopedBody = await readJson<any>(scopedRes)
    const scopedData = scopedBody?.data ?? scopedBody
    expect(scopedData.externalHypervisors.map((h: any) => h.id)).toEqual(["extA"])

    // Second: admin sees both
    getRBACContextMock.mockResolvedValue({ userId: "admin", isAdmin: true, tenantId: "default" })
    const adminRes = await callGet(GET)
    expect(adminRes.status).toBe(200)
    const adminBody = await readJson<any>(adminRes)
    const adminData = adminBody?.data ?? adminBody
    expect(adminData.externalHypervisors.map((h: any) => h.id).sort()).toEqual(["extA", "extB"])
  })
})
