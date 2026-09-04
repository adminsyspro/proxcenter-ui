import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "../../../../__tests__/setup/route-test"

// Hoist mocks so they can be referenced in vi.mock factories
const { globalFindMany, sessionFindMany, getInfraMock, getConnByIdMock, pveFetchMock } = vi.hoisted(() => ({
  globalFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  getInfraMock: vi.fn(),
  getConnByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
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

// getConnectionById echoes the connection id so the pveFetch mock can key off it
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnByIdMock(...a),
}))

// PVE fetches served from per-connection fixtures (set per test)
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))

// RBAC -- pass everything through
vi.mock("@/lib/rbac", () => ({
  // The route now resolves the caller's RBAC infra scope (issue #525); null = unrestricted.
  getCurrentRbacInfraScope: vi.fn().mockResolvedValue(null),
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))

// Stub vdcVmids helper (not under test here)
vi.mock("@/lib/alerts/vdcVmids", () => ({
  getVdcVmidsByConnection: vi.fn().mockResolvedValue(null),
}))

// Stub task scope helper
vi.mock("@/lib/tasks/scope", () => ({
  extractTaskVmid: vi.fn().mockReturnValue(null),
}))

// ---- Fixtures ------------------------------------------------------------

type EventsPayload = {
  data: any[]
  meta: { total: number; returned: number; connections: number }
}

const task = (upid: string, node: string, starttime: number, over: Record<string, unknown> = {}) => ({
  upid,
  node,
  pid: 1234,
  pstart: 1,
  starttime,
  endtime: starttime + 5, // finished tasks keep duration deterministic
  type: "qmstart",
  user: "root@pam",
  status: "OK",
  ...over,
})

const log = (uid: number, node: string, time: number, over: Record<string, unknown> = {}) => ({
  uid,
  time,
  msg: `msg-${uid}`,
  node,
  pri: 6,
  tag: "pvedaemon",
  ...over,
})

/** Per-connection PVE API fixtures, keyed by connection id. */
let clusterData: Record<string, { tasks?: any[]; logs?: any[] }>

/** Connection id whose fetches are delayed, to force Promise.all ordering. */
let delayedConnId: string | null

beforeEach(() => {
  vi.clearAllMocks()
  clusterData = {}
  delayedConnId = null

  globalFindMany.mockResolvedValue([])
  sessionFindMany.mockResolvedValue([])
  getConnByIdMock.mockImplementation(async (id: string) => ({ id, baseUrl: "https://pve.test", apiToken: "t" }))
  pveFetchMock.mockImplementation(async (connection: any, path: string) => {
    if (connection.id === delayedConnId) {
      await new Promise((r) => setTimeout(r, 15))
    }
    const d = clusterData[connection.id] || {}
    if (path === "/cluster/tasks") return d.tasks ?? []
    if (path.startsWith("/cluster/log")) return d.logs ?? []

    return []
  })
})

const twoConnsSameCluster = [
  { id: "c1", name: "MSP Demo (GRA4)", type: "pve", tenantId: "msp-demo" },
  { id: "c2", name: "PVE-STORE-GRA4", type: "pve", tenantId: "default" },
]

describe("GET /api/v1/events deduplication", () => {
  it("emits a task once when two connections see the same cluster, and meta.total counts distinct events", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    globalFindMany.mockResolvedValue(twoConnsSameCluster)

    const sharedTasks = [
      task("UPID:store1:0001:0001:65F00001:qmstart:101:root@pam:", "store1", 1000),
      task("UPID:store1:0002:0002:65F00002:vzdump:102:root@pam:", "store1", 2000),
    ]
    clusterData = { c1: { tasks: sharedTasks }, c2: { tasks: sharedTasks } }

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { source: "tasks" } })
    expect(res.status).toBe(200)

    const body = (await readJson<EventsPayload>(res))!
    expect(body.data).toHaveLength(2)
    expect(body.data.map((e) => e.id).sort()).toEqual([
      "UPID:store1:0001:0001:65F00001:qmstart:101:root@pam:",
      "UPID:store1:0002:0002:65F00002:vzdump:102:root@pam:",
    ])
    expect(body.meta.total).toBe(2)
    expect(body.meta.returned).toBe(2)
    // dedupKey is internal and must not leak into the payload
    expect(body.data[0]).not.toHaveProperty("dedupKey")
  })

  it("does not let duplicates consume the limit", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    globalFindMany.mockResolvedValue(twoConnsSameCluster)

    const sharedTasks = [
      task("UPID:store1:0001:0001:65F00001:qmstart:101:root@pam:", "store1", 1000),
      task("UPID:store1:0002:0002:65F00002:vzdump:102:root@pam:", "store1", 2000),
      task("UPID:store1:0003:0003:65F00003:qmstop:103:root@pam:", "store1", 3000),
    ]
    clusterData = { c1: { tasks: sharedTasks }, c2: { tasks: sharedTasks } }

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { source: "tasks", limit: "2" } })
    const body = (await readJson<EventsPayload>(res))!

    // Pre-fix, limit=2 returned the newest task TWICE (once per connection).
    // Now the 2 newest DISTINCT tasks come back. Each connection pre-slices
    // its own list to `limit`, so meta.total counts distinct events that
    // survived that pre-slice (2 here), not the raw duplicated 4.
    expect(body.data).toHaveLength(2)
    expect(body.data.map((e) => e.id)).toEqual([
      "UPID:store1:0003:0003:65F00003:qmstop:103:root@pam:",
      "UPID:store1:0002:0002:65F00002:vzdump:102:root@pam:",
    ])
    expect(body.meta.total).toBe(2)
  })

  it("keeps genuinely different tasks from two connections (no over-eager dedup)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    globalFindMany.mockResolvedValue(twoConnsSameCluster)

    clusterData = {
      c1: { tasks: [task("UPID:nodeA:0001:0001:65F00001:qmstart:101:root@pam:", "nodeA", 1000)] },
      c2: { tasks: [task("UPID:nodeB:0002:0002:65F00002:qmstop:202:root@pam:", "nodeB", 2000)] },
    }

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { source: "tasks" } })
    const body = (await readJson<EventsPayload>(res))!

    expect(body.data).toHaveLength(2)
    expect(body.data.map((e) => e.id).sort()).toEqual([
      "UPID:nodeA:0001:0001:65F00001:qmstart:101:root@pam:",
      "UPID:nodeB:0002:0002:65F00002:qmstop:202:root@pam:",
    ])
    expect(body.meta.total).toBe(2)
  })

  it("emits a cluster log line once when seen via two connections, keeping the id shape", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    globalFindMany.mockResolvedValue(twoConnsSameCluster)

    const sharedLogs = [log(42, "store1", 1000)]
    clusterData = { c1: { logs: sharedLogs }, c2: { logs: sharedLogs } }

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { source: "logs" } })
    const body = (await readJson<EventsPayload>(res))!

    expect(body.data).toHaveLength(1)
    expect(body.meta.total).toBe(1)
    // The emitted id keeps its existing `${connectionId}-log-${uid}` shape
    expect(body.data[0].id).toBe("c1-log-42")
  })

  it("keeps log lines from DIFFERENT clusters that share the same uid (uid is only a per-cluster sequence)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    globalFindMany.mockResolvedValue(twoConnsSameCluster)

    // Two distinct clusters, each with its own log uid=42
    clusterData = {
      c1: { logs: [log(42, "gra4-node1", 1000)] },
      c2: { logs: [log(42, "store-node1", 2000)] },
    }

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { source: "logs" } })
    const body = (await readJson<EventsPayload>(res))!

    expect(body.data).toHaveLength(2)
    expect(body.data.map((e) => e.id).sort()).toEqual(["c1-log-42", "c2-log-42"])
    expect(body.meta.total).toBe(2)
  })

  it("is deterministic: same input yields identical payloads regardless of which connection responds first", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    globalFindMany.mockResolvedValue(twoConnsSameCluster)

    const sharedTasks = [
      task("UPID:store1:0001:0001:65F00001:qmstart:101:root@pam:", "store1", 1000),
      task("UPID:store1:0002:0002:65F00002:vzdump:102:root@pam:", "store1", 1000), // same ts on purpose
    ]
    clusterData = { c1: { tasks: sharedTasks }, c2: { tasks: sharedTasks } }

    const { GET } = await import("./route")

    // Run 1: c1 responds LAST (c2 pushes into allEvents first)
    delayedConnId = "c1"
    const body1 = (await readJson<EventsPayload>(
      await callRoute(GET, { method: "GET", searchParams: { source: "tasks" } }),
    ))!

    // Run 2: c2 responds LAST (c1 pushes first)
    delayedConnId = "c2"
    const body2 = (await readJson<EventsPayload>(
      await callRoute(GET, { method: "GET", searchParams: { source: "tasks" } }),
    ))!

    // Identical order and identical connection attribution both times
    expect(body1.data).toEqual(body2.data)
    // The deterministic tiebreak attributes shared events to the smallest connectionId
    expect(body1.data.every((e) => e.connectionId === "c1")).toBe(true)
  })

  it("leaves a tenant-scoped (single-connection) request unaffected", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })
    sessionFindMany.mockResolvedValue([{ id: "c1", name: "Tenant PVE", type: "pve", tenantId: "msp-demo" }])

    clusterData = {
      c1: {
        tasks: [
          task("UPID:nodeA:0001:0001:65F00001:qmstart:101:root@pam:", "nodeA", 1000),
          task("UPID:nodeA:0002:0002:65F00002:qmstop:102:root@pam:", "nodeA", 2000),
        ],
      },
    }

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { source: "tasks" } })
    expect(res.status).toBe(200)

    const body = (await readJson<EventsPayload>(res))!
    expect(body.data).toHaveLength(2)
    expect(body.meta.total).toBe(2)
    expect(body.data.every((e) => e.connectionId === "c1")).toBe(true)
    expect(globalFindMany).not.toHaveBeenCalled()
  })
})
