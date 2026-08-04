/**
 * Scope-routing tests for GET /api/v1/inventory and for the cached burst of
 * GET /api/v1/inventory/stream (both consume the same cache and the same RBAC
 * chokepoints, so they share these mocks).
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

/** Parse an SSE body into { event, data } pairs, in emission order. */
async function readSse(res: Response): Promise<Array<{ event: string; data: any }>> {
  const body = await res.text()
  const events: Array<{ event: string; data: any }> = []
  for (const chunk of body.split("\n\n")) {
    const lines = chunk.split("\n")
    const event = lines.find(l => l.startsWith("event: "))?.slice(7)
    const raw = lines.find(l => l.startsWith("data: "))?.slice(6)
    if (event && raw !== undefined) events.push({ event, data: JSON.parse(raw) })
  }
  return events
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

// The guard is unit-tested on its own (routeGuard.test.ts) and exercised
// end-to-end for a token in reusedRoutesGuard.test.ts; here it stays a
// pass-through so this file keeps testing the handler in isolation, exactly
// like every session call the guard already delegates immediately (no
// Bearer pxc_ header on any request built by callGet).
vi.mock("@/lib/api-tokens/routeGuard", () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
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

/**
 * Same shape as makeRawInventory, with tags on the guests so a tag grant can be
 * simulated, plus one storage payload per connection (the SSE burst replays
 * cached.storages, which the snapshot route never reads):
 *   connA: n1 -> guest 100 (prod;web), n2 -> guest 200 (staging)
 *   connB: m1 -> guest 300 (staging)   <- nothing a prod-tagged user may see
 */
function makeTaggedInventory() {
  return {
    ...makeRawInventory(),
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
            guests: [{ vmid: 100, type: "qemu", status: "running", name: "vm100", node: "n1", tags: "prod;web" }],
          },
          {
            node: "n2",
            status: "online",
            guests: [{ vmid: 200, type: "qemu", status: "stopped", name: "vm200", node: "n2", tags: "staging" }],
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
            guests: [{ vmid: 300, type: "lxc", status: "running", name: "ct300", node: "m1", tags: "staging" }],
          },
        ],
      },
    ],
    externalHypervisors: [{ id: "extA", name: "vCenter A", type: "vmware" }],
    storages: [makeStorageData("connA", "Cluster A", "n1"), makeStorageData("connB", "Cluster B", "m1")],
  }
}

/** One StorageData payload as the poller caches it, for a single connection. */
function makeStorageData(connId: string, connName: string, node: string) {
  return {
    connId,
    connName,
    isCluster: false,
    nodes: [
      {
        node,
        status: "online",
        storages: [
          {
            storage: "local-lvm",
            node,
            type: "lvmthin",
            shared: false,
            content: ["images"],
            used: 1,
            total: 10,
            usedPct: 10,
            status: "active",
            enabled: true,
          },
        ],
      },
    ],
    sharedStorages: [],
  }
}

/**
 * Tagged inventory with pools, so the vDC mask and the RBAC perimeter can be
 * composed on the same tree:
 *   connA: n1 -> guest 100 (prod, poolA), n2 -> guest 200 (prod, poolB)
 * A tenant whose vDC only owns poolA must end up with n1 alone: n2's only guest
 * is dropped by the vDC pool filter, so the node is no longer a perimeter.
 */
function makePooledInventory() {
  return {
    ...makeRawInventory(),
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
            guests: [{ vmid: 100, type: "qemu", status: "running", name: "vm100", node: "n1", tags: "prod", pool: "poolA" }],
          },
          {
            node: "n2",
            status: "online",
            guests: [{ vmid: 200, type: "qemu", status: "running", name: "vm200", node: "n2", tags: "prod", pool: "poolB" }],
          },
        ],
      },
    ],
  }
}

/** Minimal iaas vDC scope: connA, nodes n1+n2, pool poolA only. */
function poolAVdcScope() {
  return {
    kind: "iaas" as const,
    vdcScope: {
      connectionIds: new Set(["connA"]),
      pbsConnectionIds: new Set<string>(),
      nodesByConnection: new Map([["connA", new Set(["n1", "n2"])]]),
      storagesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map([["connA", new Set(["poolA"])]]),
      vnetsByConnection: new Map<string, Set<string>>(),
      sharedBridgesByConnection: new Map<string, Set<string>>(),
      pbsNamespacesByConnection: new Map<string, Array<{ datastore: string; namespace: string }>>(),
      pbsNamespacesByPveConnection: new Map<string, Set<string>>(),
    },
  }
}

/** Stand-in for the real per-guest RBAC filter: keeps guests tagged `prod`. */
function keepProdTaggedGuests() {
  filterVmsByPermissionMock.mockImplementation((_principal: any, vms: any[]) =>
    Promise.resolve(vms.filter(vm => String(vm.tags || "").split(/[;,]/).includes("prod")))
  )
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

// ---------------------------------------------------------------------------
// Guest-derived perimeter (tag / pool grants) -- issue #633
// ---------------------------------------------------------------------------

describe("GET /api/v1/inventory guest-derived perimeter (tag/pool scopes)", () => {
  beforeEach(() => {
    getInventoryFromCacheMock.mockReturnValue({ status: "fresh", data: makeTaggedInventory() })
    keepProdTaggedGuests()
    getRBACContextMock.mockResolvedValue({ userId: "u-tag", isAdmin: false, tenantId: "default" })
  })

  /** A user whose only grant is `tag=prod`: no infra set at all. */
  function tagOnlyScope() {
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      guestDerived: true,
    })
  }

  it("tag-scoped user: keeps the connection and only the nodes hosting a visible guest", async () => {
    tagOnlyScope()

    const { GET } = await import("./route")
    const res = await callGet(GET)
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    const data = body?.data ?? body

    expect(data.clusters.map((c: any) => c.id)).toEqual(["connA"])
    expect(data.clusters[0].nodes.map((n: any) => n.node)).toEqual(["n1"])
    // vmid is stringified by the route before the per-guest filter runs.
    expect(data.clusters[0].nodes[0].guests.map((g: any) => g.vmid)).toEqual(["100"])
  })

  it("tag-scoped user: drops a connection where no guest survived", async () => {
    tagOnlyScope()

    const { GET } = await import("./route")
    const res = await callGet(GET)
    const body = await readJson<any>(res)
    const data = body?.data ?? body

    // connB only hosts staging guests -> nothing left, so no bare shell.
    expect(data.clusters.map((c: any) => c.id)).toEqual(["connA"])
    expect(data.stats.totalClusters).toBe(1)
  })

  it("tag-scoped user: PBS servers and external hypervisors stay hidden", async () => {
    tagOnlyScope()

    const { GET } = await import("./route")
    const res = await callGet(GET)
    const body = await readJson<any>(res)
    const data = body?.data ?? body

    expect(data.pbsServers).toEqual([])
    expect(data.externalHypervisors).toEqual([])
    expect(data.stats.totalPbsServers).toBe(0)
  })

  it("tag-scoped user: stats are recomputed from the pruned tree", async () => {
    tagOnlyScope()

    const { GET } = await import("./route")
    const res = await callGet(GET)
    const body = await readJson<any>(res)
    const data = body?.data ?? body

    expect(data.stats.totalNodes).toBe(1)
    expect(data.stats.onlineNodes).toBe(1)
    expect(data.stats.totalGuests).toBe(1)
    expect(data.stats.runningGuests).toBe(1)
  })

  it("tag-scoped user: nothing visible anywhere yields an empty tree, not a shell", async () => {
    tagOnlyScope()
    // No guest matches the grant on any connection.
    filterVmsByPermissionMock.mockResolvedValue([])

    const { GET } = await import("./route")
    const res = await callGet(GET)
    const body = await readJson<any>(res)
    const data = body?.data ?? body

    expect(data.clusters).toEqual([])
    expect(data.stats.totalGuests).toBe(0)
  })

  it("tag + node grant: the granted node is kept even with no visible guest on it", async () => {
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["connA", new Set(["n2"])]]),
      guestDerived: true,
    })

    const { GET } = await import("./route")
    const res = await callGet(GET)
    const body = await readJson<any>(res)
    const data = body?.data ?? body

    expect(data.clusters.map((c: any) => c.id)).toEqual(["connA"])
    // n1 comes from the tag grant, n2 from the explicit node grant (empty).
    expect(data.clusters[0].nodes.map((n: any) => n.node)).toEqual(["n1", "n2"])
    expect(data.stats.totalNodes).toBe(2)
    expect(data.stats.totalGuests).toBe(1)
  })

  it("tag + connection grant: the whole granted connection stays, even empty", async () => {
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(["connB"]),
      nodesByConnection: new Map<string, Set<string>>(),
      guestDerived: true,
    })

    const { GET } = await import("./route")
    const res = await callGet(GET)
    const body = await readJson<any>(res)
    const data = body?.data ?? body

    // connA survives through its prod guest, connB through the outright grant.
    expect(data.clusters.map((c: any) => c.id).sort()).toEqual(["connA", "connB"])
    const connB = data.clusters.find((c: any) => c.id === "connB")
    expect(connB.nodes.map((n: any) => n.node)).toEqual(["m1"])
    expect(connB.nodes[0].guests).toEqual([])
  })

  it("node-scoped user is unaffected: guestDerived false still prunes to the granted node", async () => {
    // Same fixture and same guest filter, but a purely infra-derived perimeter.
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["connA", new Set(["n1"])]]),
      guestDerived: false,
    })

    const { GET } = await import("./route")
    const res = await callGet(GET)
    const body = await readJson<any>(res)
    const data = body?.data ?? body

    expect(data.clusters.map((c: any) => c.id)).toEqual(["connA"])
    expect(data.clusters[0].nodes.map((n: any) => n.node)).toEqual(["n1"])
    expect(data.stats.totalNodes).toBe(1)
  })

  it("node-scoped user keeps a granted connection whose nodes all lost their guests", async () => {
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["connA", new Set(["n2"])]]),
      guestDerived: false,
    })

    const { GET } = await import("./route")
    const res = await callGet(GET)
    const body = await readJson<any>(res)
    const data = body?.data ?? body

    // The connection prune must not touch an outright grant.
    expect(data.clusters.map((c: any) => c.id)).toEqual(["connA"])
    expect(data.clusters[0].nodes.map((n: any) => n.node)).toEqual(["n2"])
    expect(data.stats.totalGuests).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SSE cached burst: same perimeter rules, and the composition ORDER
// ---------------------------------------------------------------------------

describe("GET /api/v1/inventory/stream cached burst", () => {
  /** Drive the stream handler and return its parsed events. */
  async function callStream() {
    const { GET } = await import("./stream/route")
    const req = new NextRequest("http://test.local/api/v1/inventory/stream")
    return readSse(await GET(req))
  }

  const clusterIds = (events: Array<{ event: string; data: any }>) =>
    events.filter(e => e.event === "cluster").map(e => e.data.id)

  beforeEach(() => {
    getInventoryFromCacheMock.mockReturnValue({ status: "fresh", data: makeTaggedInventory() })
    keepProdTaggedGuests()
    getRBACContextMock.mockResolvedValue({ userId: "u-tag", isAdmin: false, tenantId: "default" })
  })

  it("tag-scoped user: streams only the connection and node that kept a guest", async () => {
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      guestDerived: true,
    })

    const events = await callStream()

    expect(clusterIds(events)).toEqual(["connA"])
    const connA = events.find(e => e.event === "cluster")!.data
    expect(connA.nodes.map((n: any) => n.node)).toEqual(["n1"])
    expect(connA.nodes[0].guests.map((g: any) => g.vmid)).toEqual(["100"])
    // init must not promise a cluster that got dropped.
    expect(events.find(e => e.event === "init")!.data.totalPve).toBe(1)
  })

  it("tag-scoped user: no PBS and no external event", async () => {
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      guestDerived: true,
    })

    const events = await callStream()

    expect(events.filter(e => e.event === "pbs")).toEqual([])
    expect(events.filter(e => e.event === "external")).toEqual([])
  })

  it("tag-scoped user: no storage event at all, but the cluster event still arrives", async () => {
    // Storage is host data. A guest-derived perimeter never grants it, on the
    // cached path exactly like on the cache-miss path (issue #633).
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      guestDerived: true,
    })

    const events = await callStream()

    expect(events.filter(e => e.event === "storage")).toEqual([])
    expect(clusterIds(events)).toEqual(["connA"])
  })

  it("node-scoped user still gets the storage event of the connection they hold", async () => {
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["connA", new Set(["n1"])]]),
      guestDerived: false,
    })

    const events = await callStream()

    // connA is granted, connB is not: the gate is the same strict predicate the
    // cache-miss path uses, so both paths agree.
    expect(events.filter(e => e.event === "storage").map(e => e.data.connId)).toEqual(["connA"])
  })

  it("admin: every storage event is streamed", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "admin", isAdmin: true, tenantId: "default" })

    const events = await callStream()

    expect(events.filter(e => e.event === "storage").map(e => e.data.connId)).toEqual(["connA", "connB"])
  })

  it("node-scoped user is unaffected: only the granted node is streamed", async () => {
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["connA", new Set(["n1"])]]),
      guestDerived: false,
    })

    const events = await callStream()

    expect(clusterIds(events)).toEqual(["connA"])
    expect(events.find(e => e.event === "cluster")!.data.nodes.map((n: any) => n.node)).toEqual(["n1"])
  })

  it("admin: every cluster and node is streamed, and the scope is never consulted", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "admin", isAdmin: true, tenantId: "default" })

    const events = await callStream()

    expect(clusterIds(events).sort()).toEqual(["connA", "connB"])
    expect(getRbacInfraScopeMock).not.toHaveBeenCalled()
  })

  it("vDC tenant with a tag grant: the perimeter is computed AFTER the vDC pool filter", async () => {
    // n2's only guest is prod-tagged (RBAC keeps it) but sits in poolB, which
    // the vDC drops. The node must not survive as an empty shell: proof the
    // RBAC node prune runs after applyVdcFilter, not before it.
    getInventoryFromCacheMock.mockReturnValue({ status: "fresh", data: makePooledInventory() })
    getInfraMock.mockResolvedValue(poolAVdcScope())
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      guestDerived: true,
    })

    const events = await callStream()

    expect(clusterIds(events)).toEqual(["connA"])
    const connA = events.find(e => e.event === "cluster")!.data
    expect(connA.nodes.map((n: any) => n.node)).toEqual(["n1"])
    expect(connA.nodes[0].guests.map((g: any) => g.vmid)).toEqual(["100"])
  })

  it("vDC tenant with a tag grant: nothing left in the vDC means no cluster event", async () => {
    getInventoryFromCacheMock.mockReturnValue({ status: "fresh", data: makePooledInventory() })
    getInfraMock.mockResolvedValue(poolAVdcScope())
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      guestDerived: true,
    })
    // The tag grant matches nothing at all.
    filterVmsByPermissionMock.mockResolvedValue([])

    const events = await callStream()

    expect(clusterIds(events)).toEqual([])
    expect(events.find(e => e.event === "init")!.data.totalPve).toBe(0)
  })
})
