/**
 * GET /api/v1/inventory/stream on a cache miss (#125): every reader of the
 * same (tenant, vDC context) shares one fan-out and narrows it to its own
 * grants, a stale entry is refreshed for the next reader, and the cache entry
 * no longer depends on who filled it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { NextRequest } from "next/server"

const { pveFetchMock, findManyMock, rbacCtxMock, rbacScopeMock, tenantMock, vdcContextMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  findManyMock: vi.fn(),
  rbacCtxMock: vi.fn(),
  rbacScopeMock: vi.fn(),
  tenantMock: vi.fn(),
  vdcContextMock: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => tenantMock(),
  getSessionPrisma: async () => ({ connection: { findMany: findManyMock } }),
  DEFAULT_TENANT_ID: "default",
}))
vi.mock("@/lib/vdc/context", () => ({ getVdcContext: async () => vdcContextMock() }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: async () => ({ kind: "provider" }),
}))
vi.mock("@/lib/rbac", async (orig) => ({
  ...(await orig<typeof import("@/lib/rbac")>()),
  checkPermission: async () => null,
  getRBACContext: async () => rbacCtxMock(),
  getRbacInfraScope: async () => rbacScopeMock(),
  filterVmsByPermission: async (_u: string, vms: any[]) => vms,
}))
vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: () => null }))
vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: { findMany: findManyMock } } }))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: async (id: string) => ({ id }),
  getPbsConnectionByIdUnscoped: async (id: string) => ({ id }),
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock("@/lib/proxmox/pbs-client", () => ({ pbsFetch: async () => { throw new Error("PBS offline in this test") } }))

import { getInventoryFromCache, invalidateInventoryCache, setCachedInventory, setInflightFetch } from "@/lib/cache/inventoryCache"

import { GET } from "./route"

type Sse = Array<{ event: string; data: any }>

async function readSse(res: Response): Promise<Sse> {
  const events: Sse = []
  for (const chunk of (await res.text()).split("\n\n")) {
    const lines = chunk.split("\n")
    const event = lines.find(l => l.startsWith("event: "))?.slice(7)
    const raw = lines.find(l => l.startsWith("data: "))?.slice(6)
    if (event && raw !== undefined) events.push({ event, data: JSON.parse(raw) })
  }
  return events
}

const open = (query = "") => GET(new NextRequest(`http://test.local/api/v1/inventory/stream${query}`))
const ids = (events: Sse, kind: string) => events.filter(e => e.event === kind).map(e => e.data.id ?? e.data.connId).sort()

const ADMIN = { isAdmin: true, userId: "admin", tenantId: "default" }
const VIEWER_A = { isAdmin: false, userId: "viewer", tenantId: "default" }
/** A viewer granted connA only: no connB, no PBS. */
const SCOPE_A = { fullConnections: new Set(["connA"]), nodesByConnection: new Map() }

/** Holds every `/nodes` call until released, so two readers overlap. */
let releaseNodes: () => void
let nodesGate: Promise<void>

/** One fan-out reads `/nodes` once per PVE connection. */
const fanOuts = () => pveFetchMock.mock.calls.filter(([, path]) => path === "/nodes").length / 2

beforeEach(() => {
  invalidateInventoryCache()
  nodesGate = new Promise(r => { releaseNodes = r })
  tenantMock.mockReset().mockReturnValue("default")
  vdcContextMock.mockReset().mockReturnValue(null)
  rbacCtxMock.mockReset().mockReturnValue(ADMIN)
  rbacScopeMock.mockReset().mockReturnValue(null)
  findManyMock.mockReset().mockImplementation(async ({ where }: any) => {
    if (where?.type === "pve") return [
      { id: "connA", name: "Cluster A", type: "pve", tenantId: "default" },
      { id: "connB", name: "Cluster B", type: "pve", tenantId: "default" },
    ]
    if (where?.type === "pbs") return [{ id: "pbs1", name: "PBS", type: "pbs" }]
    return []
  })
  pveFetchMock.mockReset().mockImplementation(async (_conn: any, path: string) => {
    if (path === "/nodes") {
      await nodesGate
      return [{ node: "n1", status: "online" }]
    }
    if (path === "/cluster/resources?type=storage") {
      return [{ storage: "local", node: "n1", plugintype: "dir", status: "available", disk: 10, maxdisk: 100 }]
    }
    if (path === "/storage") return [{ storage: "local", type: "dir", content: "images" }]
    return []
  })
})

describe("inventory stream: one shared fan-out per scope (#125)", () => {
  it("two readers on a cold cache share one fan-out and both get the whole inventory", async () => {
    const first = open()
    const second = open()
    await new Promise(r => setTimeout(r, 0))
    releaseNodes()

    const [a, b] = await Promise.all([first.then(readSse), second.then(readSse)])

    expect(fanOuts()).toBe(1)
    for (const events of [a, b]) {
      expect(events[0]).toMatchObject({ event: "init", data: { totalPve: 2, totalPbs: 1, cached: false } })
      expect(ids(events, "cluster")).toEqual(["connA", "connB"])
      expect(ids(events, "pbs")).toEqual(["pbs1"])
      expect(events.at(-1)?.event).toBe("done")
    }
    expect(getInventoryFromCache("default", null).status).toBe("fresh")
  })

  it("narrows the shared fan-out per reader: a viewer of connA never receives connB nor the PBS", async () => {
    rbacCtxMock.mockReturnValueOnce(VIEWER_A)
    rbacScopeMock.mockReturnValueOnce(SCOPE_A)
    const viewer = open()
    const admin = open()
    await new Promise(r => setTimeout(r, 0))
    releaseNodes()

    const [v, a] = await Promise.all([viewer.then(readSse), admin.then(readSse)])

    expect(fanOuts()).toBe(1)
    expect(v[0]).toMatchObject({ event: "init", data: { totalPve: 1, totalPbs: 0 } })
    expect(ids(v, "cluster")).toEqual(["connA"])
    expect(ids(v, "storage")).toEqual(["connA"])
    expect(ids(v, "pbs")).toEqual([])
    expect(ids(a, "cluster")).toEqual(["connA", "connB"])
    expect(ids(a, "pbs")).toEqual(["pbs1"])
  })

  it("a restricted reader filling the cache no longer hides the PBS from the admin", async () => {
    rbacCtxMock.mockReturnValueOnce(VIEWER_A)
    rbacScopeMock.mockReturnValueOnce(SCOPE_A)
    releaseNodes()
    await readSse(await open())

    const admin = await readSse(await open())

    expect(admin[0]).toMatchObject({ event: "init", data: { cached: true, totalPbs: 1 } })
    expect(ids(admin, "pbs")).toEqual(["pbs1"])
    expect(ids(admin, "cluster")).toEqual(["connA", "connB"])
  })

  it("keeps vDC contexts apart: each has its own fan-out and its own entry", async () => {
    tenantMock.mockReturnValue("t-iaas")
    vdcContextMock.mockReturnValueOnce("vdc-a").mockReturnValueOnce("vdc-b")
    const a = open()
    const b = open()
    await new Promise(r => setTimeout(r, 0))
    releaseNodes()
    await Promise.all([a.then(readSse), b.then(readSse)])

    expect(fanOuts()).toBe(2)
    expect(getInventoryFromCache("t-iaas", "vdc-a").status).toBe("fresh")
    expect(getInventoryFromCache("t-iaas", "vdc-b").status).toBe("fresh")
    expect(getInventoryFromCache("t-iaas", null).status).toBe("miss")
  })

  it("the tree's refresh starts its own fan-out instead of joining one that may predate the change", async () => {
    const plain = open()
    const forced = open("?refresh=true")
    await new Promise(r => setTimeout(r, 0))
    releaseNodes()
    await Promise.all([plain.then(readSse), forced.then(readSse)])

    expect(fanOuts()).toBe(2)
  })

  it("a reader leaving mid-stream does not stop the fan-out: the cache is still filled", async () => {
    const res = await open()
    await res.body!.cancel()
    releaseNodes()
    await vi.waitFor(() => expect(getInventoryFromCache("default", null).status).toBe("fresh"))
  })

  it("waits for a blocking /api/v1/inventory read already fetching the scope", async () => {
    let resolveRaw!: (v: any) => void
    setInflightFetch(new Promise(r => { resolveRaw = r }), "default", null)
    const pending = open()
    resolveRaw({
      clusters: [{ id: "connA", name: "Cluster A", type: "pve", isCluster: false, status: "online", nodes: [] }],
      pbsServers: [], externalHypervisors: [], storages: [],
      stats: { totalClusters: 1, totalNodes: 0, totalGuests: 0, onlineNodes: 0, runningGuests: 0, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0 },
    })

    const events = await readSse(await pending)

    expect(events[0]).toMatchObject({ event: "init", data: { cached: true } })
    expect(ids(events, "cluster")).toEqual(["connA"])
    expect(fanOuts()).toBe(0)
  })

  it("reports a failed fan-out to every reader", async () => {
    findManyMock.mockRejectedValue(new Error("database gone"))

    const events = await readSse(await open())

    expect(events).toEqual([{ event: "error", data: { message: "database gone" } }])
  })
})

describe("inventory stream: stale entry (#125)", () => {
  it("is served at once and refreshed in the background for the next reader", async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, "now").mockReturnValue(now - 5 * 60_000)
    setCachedInventory({
      clusters: [{ id: "connA", name: "Old A", type: "pve", isCluster: false, status: "online", nodes: [] }],
      pbsServers: [], externalHypervisors: [], storages: [],
      stats: { totalClusters: 1, totalNodes: 0, totalGuests: 0, onlineNodes: 0, runningGuests: 0, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0 },
    }, "default", null)
    clock.mockReturnValue(now)
    releaseNodes()

    const events = await readSse(await open())

    expect(events[0]).toMatchObject({ event: "init", data: { cached: true } })
    expect(events.find(e => e.event === "cluster")?.data.name).toBe("Old A")
    await vi.waitFor(() => expect((getInventoryFromCache("default", null) as any).data.clusters).toHaveLength(2))
    expect(getInventoryFromCache("default", null).status).toBe("fresh")
    expect(fanOuts()).toBe(1)
    clock.mockRestore()
  })

  it("starts no second fetch when one is already refreshing the scope", async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, "now").mockReturnValue(now - 5 * 60_000)
    setCachedInventory({
      clusters: [], pbsServers: [], externalHypervisors: [], storages: [],
      stats: { totalClusters: 0, totalNodes: 0, totalGuests: 0, onlineNodes: 0, runningGuests: 0, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0 },
    }, "default", null)
    clock.mockReturnValue(now)
    setInflightFetch(new Promise(() => {}), "default", null)
    releaseNodes()

    await readSse(await open())
    await new Promise(r => setTimeout(r, 10))

    expect(fanOuts()).toBe(0)
    clock.mockRestore()
  })
})
