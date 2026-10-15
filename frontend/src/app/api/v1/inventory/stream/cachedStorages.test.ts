/**
 * The cached burst of GET /api/v1/inventory/stream and the `storages` of the
 * shared inventory cache. fetchRawInventory (/api/v1/inventory, the Prometheus
 * scrape) writes the entry WITHOUT the tree's storages; the burst used to
 * replay it as is and the tree lost its STORAGE section until the next cache
 * miss. It now fetches them and keeps them on the entry.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { NextRequest } from "next/server"

const { pveFetchMock, findManyMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  findManyMock: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => "t1",
  getSessionPrisma: async () => ({}),
  DEFAULT_TENANT_ID: "default",
}))
vi.mock("@/lib/vdc/context", () => ({ getVdcContext: async () => null }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: async () => ({ kind: "provider" }),
}))
vi.mock("@/lib/rbac", async (orig) => ({
  ...(await orig<typeof import("@/lib/rbac")>()),
  checkPermission: async () => null,
  getRBACContext: async () => ({ isAdmin: true, userId: "u1", tenantId: "t1" }),
}))
vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: () => null }))
vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: { findMany: findManyMock } } }))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: async (id: string, tenantId?: string) => ({ id, tenantId }),
  getPbsConnectionByIdUnscoped: async () => ({}),
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock("@/lib/proxmox/pbs-client", () => ({ pbsFetch: vi.fn() }))

import { getInventoryFromCache, invalidateInventoryCache, setCachedInventory } from "@/lib/cache/inventoryCache"

import { GET } from "./route"

async function readSse(res: Response): Promise<Array<{ event: string; data: any }>> {
  const events: Array<{ event: string; data: any }> = []
  for (const chunk of (await res.text()).split("\n\n")) {
    const lines = chunk.split("\n")
    const event = lines.find(l => l.startsWith("event: "))?.slice(7)
    const raw = lines.find(l => l.startsWith("data: "))?.slice(6)
    if (event && raw !== undefined) events.push({ event, data: JSON.parse(raw) })
  }
  return events
}

const stream = async () => readSse(await GET(new NextRequest("http://test.local/api/v1/inventory/stream")))

/** What fetchRawInventory writes: clusters and the metrics rollup, no `storages`. */
function rawInventoryEntry() {
  return {
    clusters: [{
      id: "connA", name: "Cluster A", type: "pve", isCluster: false, status: "online",
      nodes: [{ node: "n1", status: "online", guests: [] }],
    }],
    pbsServers: [],
    externalHypervisors: [],
    storageResources: [{ id: "connA:local", storage: "local", connId: "connA", connName: "Cluster A", used: 1, total: 2 }],
    stats: { totalClusters: 1, totalNodes: 1, totalGuests: 0, onlineNodes: 1, runningGuests: 0, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0 },
  }
}

beforeEach(() => {
  invalidateInventoryCache()
  findManyMock.mockReset().mockResolvedValue([{ id: "connA", name: "Cluster A", type: "pve", tenantId: "owner-1" }])
  pveFetchMock.mockReset().mockImplementation(async (_conn: any, path: string) => {
    if (path === "/cluster/resources?type=storage") {
      return [{ storage: "local", node: "n1", plugintype: "dir", status: "available", disk: 10, maxdisk: 100 }]
    }
    if (path === "/storage") return [{ storage: "local", type: "dir", content: "images,iso" }]
    throw new Error(`unexpected pveFetch ${path}`)
  })
})

describe("inventory stream, cached burst: tree storages (#938 recette, #921)", () => {
  it("fetches the storages an entry written by fetchRawInventory lacks, and keeps them on the entry", async () => {
    setCachedInventory(rawInventoryEntry() as any, "t1", null)

    const events = await stream()

    expect(events[0]).toMatchObject({ event: "init", data: { cached: true } })
    const storages = events.filter(e => e.event === "storage")
    expect(storages).toHaveLength(1)
    expect(storages[0].data).toMatchObject({ connId: "connA", connName: "Cluster A" })
    expect(storages[0].data.nodes[0]).toMatchObject({ node: "n1" })
    expect(storages[0].data.nodes[0].storages[0]).toMatchObject({ storage: "local", total: 100 })
    // The owner tenant of the connection, read back from the database.
    expect(pveFetchMock.mock.calls[0][0]).toEqual({ id: "connA", tenantId: "owner-1" })

    const cache = getInventoryFromCache("t1", null)
    expect(cache.status).toBe("fresh")
    expect((cache as any).data.storages).toHaveLength(1)
    expect((cache as any).data.storageResources).toHaveLength(1)

    // A second reader is served from the entry, no storage call.
    pveFetchMock.mockClear()
    expect((await stream()).filter(e => e.event === "storage")).toHaveLength(1)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("replays the storages the stream itself cached, without a call", async () => {
    setCachedInventory({
      ...rawInventoryEntry(),
      storages: [{ connId: "connA", connName: "Cluster A", isCluster: false, nodes: [{ node: "n1", status: "online", storages: [] }], sharedStorages: [] }],
    } as any, "t1", null)

    const events = await stream()

    expect(events.filter(e => e.event === "storage")).toHaveLength(1)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("still skips a malformed storage payload", async () => {
    setCachedInventory({ ...rawInventoryEntry(), storages: [{ connId: "connA", connName: "Cluster A" }] } as any, "t1", null)

    expect((await stream()).filter(e => e.event === "storage")).toEqual([])
  })

  it("asks the database for nothing when the entry has no cluster", async () => {
    setCachedInventory({ ...rawInventoryEntry(), clusters: [] } as any, "t1", null)

    const events = await stream()

    expect(events.filter(e => e.event === "storage")).toEqual([])
    expect(findManyMock).not.toHaveBeenCalled()
  })

  it("a full fetch caches the tree storages AND the metrics rollup, so neither reader finds its half missing", async () => {
    findManyMock.mockImplementation(async ({ where }: any) =>
      where?.type === "pve" ? [{ id: "connA", name: "Cluster A", type: "pve", tenantId: "owner-1" }] : [])
    const base = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation(async (conn: any, path: string) => {
      if (path === "/nodes") return [{ node: "n1", status: "online" }]
      if (path.startsWith("/cluster/resources?type=storage") || path === "/storage") return base(conn, path)
      return []
    })

    const events = await readSse(await GET(new NextRequest("http://test.local/api/v1/inventory/stream?refresh=true")))

    expect(events.filter(e => e.event === "storage")).toHaveLength(1)
    const cache = getInventoryFromCache("t1", null) as any
    expect(cache.data.storages).toHaveLength(1)
    expect(cache.data.storageResources).toEqual([
      expect.objectContaining({ storage: "local", connId: "connA", total: 100 }),
    ])
  })
})
