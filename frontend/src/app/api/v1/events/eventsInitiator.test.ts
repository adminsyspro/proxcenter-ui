import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../__tests__/setup/route-test"

// roadmap#41: PVE tasks keep their technical `user`, and gain `initiatedBy`
// from the audit journal, scoped to the caller's tenant.

const { getInfraMock, pveFetchMock, findInitiatorsMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  pveFetchMock: vi.fn(),
  findInitiatorsMock: vi.fn(),
}))

vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { findMany: vi.fn().mockResolvedValue([{ id: "p1", name: "PVE 1", type: "pve" }]) } }),
  getCurrentTenantId: async () => currentTenant,
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: { connection: { findMany: vi.fn().mockResolvedValue([{ id: "p1", name: "PVE 1", type: "pve" }]) } },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn().mockResolvedValue({ baseUrl: "https://pve", apiToken: "t" }),
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: pveFetchMock }))
const deniedPermissions = new Set<string>()
vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn(async (perm: string) => (deniedPermissions.has(perm) ? new Response(null, { status: 403 }) : null)),
  getCurrentRbacInfraScope: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", ADMIN_AUDIT: "admin.audit" },
}))
vi.mock("@/lib/auth/principal", () => ({ getPrincipal: async () => ({ ok: true, principal: { kind: "session", userId: "u-self" } }) }))
vi.mock("@/lib/alerts/vdcVmids", () => ({ getVdcVmidsByConnection: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/audit/taskInitiators", () => ({ findTaskInitiators: (...a: any[]) => findInitiatorsMock(...a) }))

let currentTenant = "default"

const VNC = "UPID:n1:00000001:00000001:00000FA0:vncproxy:100:proxcenter@pve!api:"
const START = "UPID:n1:00000002:00000002:00000FA1:qmstart:101:proxcenter@pve!api:"

beforeEach(() => {
  vi.clearAllMocks()
  deniedPermissions.clear()
  currentTenant = "default"
  getInfraMock.mockResolvedValue({ kind: "provider" })
  pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path === "/cluster/tasks") {
      return [
        { upid: VNC, node: "n1", type: "vncproxy", id: "100", user: "proxcenter@pve!api", starttime: 4000, status: "OK", pid: 1, pstart: 1 },
        { upid: START, node: "n1", type: "qmstart", id: "101", user: "proxcenter@pve!api", starttime: 4001, status: "OK", pid: 2, pstart: 2 },
      ]
    }

    return []
  })
  findInitiatorsMock.mockResolvedValue(new Map([[VNC, { email: "alice@example.com", apiTokenId: null }]]))
})

describe("GET /api/v1/events task initiator (roadmap#41)", () => {
  it("adds initiatedBy next to the untouched technical user, in one lookup", async () => {
    const { GET } = await import("./route")
    const body = await (await callRoute(GET, { method: "GET", url: "http://localhost/api/v1/events?source=tasks" })).json()

    const vnc = body.data.find((e: any) => e.id === VNC)
    const start = body.data.find((e: any) => e.id === START)
    expect(vnc.user).toBe("proxcenter@pve!api")
    expect(vnc.initiatedBy).toEqual({ email: "alice@example.com", apiTokenId: null })
    expect(start.initiatedBy).toBeUndefined()

    expect(findInitiatorsMock).toHaveBeenCalledTimes(1)
    const [upids, opts] = findInitiatorsMock.mock.calls[0]
    expect(new Set(upids)).toEqual(new Set([VNC, START]))
    expect(opts.tenantId).toBeNull()
    expect(opts.since.getTime()).toBeLessThanOrEqual(4000 * 1000)
  })

  it("without admin.audit, only the caller's own actions are attributed", async () => {
    const { GET } = await import("./route")
    await callRoute(GET, { method: "GET", url: "http://localhost/api/v1/events?source=tasks" })
    expect(findInitiatorsMock.mock.calls[0][1].onlyFor).toBeUndefined()

    deniedPermissions.add("admin.audit")
    await callRoute(GET, { method: "GET", url: "http://localhost/api/v1/events?source=tasks" })
    expect(findInitiatorsMock.mock.calls[1][1].onlyFor).toEqual({ userId: "u-self", apiTokenId: undefined })
  })

  it("restricts a tenant to its own journal", async () => {
    currentTenant = "tenant-a"
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["p1"]) })

    const { GET } = await import("./route")
    await callRoute(GET, { method: "GET", url: "http://localhost/api/v1/events?source=tasks" })

    expect(findInitiatorsMock.mock.calls[0][1].tenantId).toBe("tenant-a")
  })

  it("still serves the feed when the journal lookup fails", async () => {
    findInitiatorsMock.mockRejectedValueOnce(new Error("db down"))

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", url: "http://localhost/api/v1/events?source=tasks" })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(2)
  })
})
