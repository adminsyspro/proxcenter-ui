import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

import { callRoute } from "../../../../__tests__/setup/route-test"

const m = vi.hoisted(() => ({
  globalFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  getInfra: vi.fn(),
  getConnById: vi.fn(),
  getGpus: vi.fn(),
  checkPermission: vi.fn(),
  getRBACContext: vi.fn(),
  filterNodes: vi.fn(),
  filterVms: vi.fn(),
}))

vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => m.getInfra(...a),
}))
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { findMany: m.sessionFindMany } }),
  getCurrentTenantId: async () => "t1",
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: { findMany: m.globalFindMany } } }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: (...a: any[]) => m.getConnById(...a) }))
vi.mock("@/lib/gpu/collect", () => ({ getConnectionGpus: (...a: any[]) => m.getGpus(...a) }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => m.checkPermission(...a),
  getRBACContext: (...a: any[]) => m.getRBACContext(...a),
  filterNodesByPermission: (...a: any[]) => m.filterNodes(...a),
  filterVmsByPermission: (...a: any[]) => m.filterVms(...a),
  PERMISSIONS: { VM_VIEW: "vm.view", NODE_VIEW: "node.view" },
}))

import { GET } from "./route"

const device = (node: string) => ({
  key: `c1:${node}:0000:01:00`, connId: "c1", node, id: "0000:01:00.0", slot: "0000:01:00",
  functions: ["0000:01:00.0"], displayFunctions: ["0000:01:00.0"], vendorId: "0x10de", deviceId: "0x2204",
  vendorName: "NVIDIA", deviceName: "GA102", subsystemName: null, classCode: "0x030000", iommuGroup: 1,
  iommuIsolated: true, mdev: false, kind: "gpu", consoleReason: null, mappings: [],
})
const alloc = (vmid: string, node: string, pool: string | null) => ({
  deviceKey: `c1:${node}:0000:01:00`, connId: "c1", node, vmid, vmName: `vm-${vmid}`, vmStatus: "running",
  template: false, pool, tags: [], hostpci: "hostpci0", via: "address", mapping: null, mdev: null, pooled: false,
})
const SNAP = {
  connId: "c1", connectionName: "PROD", error: null,
  nodes: [{ node: "n1", online: true, error: null }, { node: "n2", online: true, error: null }],
  devices: [device("n1"), device("n2")],
  allocations: [alloc("100", "n1", null), alloc("200", "n2", "tenant-pool")],
  configReads: 2, generatedAt: "2026-10-14T08:00:00.000Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  m.globalFindMany.mockResolvedValue([{ id: "c1", name: "PROD", tenantId: "default" }, { id: "c2", name: "DR", tenantId: "default" }])
  m.sessionFindMany.mockResolvedValue([])
  m.getInfra.mockResolvedValue({ kind: "provider" })
  m.getConnById.mockResolvedValue({ baseUrl: "https://pve", apiToken: "x" })
  m.getGpus.mockImplementation(async (_d: any, conn: any) => (conn.id === "c1" ? SNAP : { ...SNAP, connId: "c2", connectionName: "DR", nodes: [], devices: [], allocations: [] }))
  m.checkPermission.mockResolvedValue(null)
  m.getRBACContext.mockResolvedValue({ isAdmin: true, tenantId: "default", userId: "u1" })
  m.filterNodes.mockImplementation(async (_p: any, list: any[]) => list)
  m.filterVms.mockImplementation(async (_p: any, list: any[]) => list)
})

describe("GET /api/v1/gpu", () => {
  it("denies a caller without vm.view nor node.view", async () => {
    const denied = NextResponse.json({ error: "Permission denied: vm.view" }, { status: 403 })
    m.checkPermission.mockResolvedValueOnce(denied).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }))
    const res = await callRoute(GET)
    expect(res.status).toBe(403)
    expect(m.getGpus).not.toHaveBeenCalled()
  })

  it("lets a node.view-only caller in", async () => {
    m.checkPermission.mockResolvedValueOnce(NextResponse.json({}, { status: 403 })).mockResolvedValueOnce(null)
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
  })

  it("provider admin: whole inventory of every connection, connId and refresh passed through", async () => {
    let res = await callRoute(GET)
    let body = await res.json()
    expect(body.data.scope).toBe("infrastructure")
    expect(body.data.devices).toHaveLength(2)
    expect(body.data.capacity).toEqual({ total: 2, allocated: 2, free: 0, inUse: 2, consoles: 0 })
    expect(m.getGpus).toHaveBeenCalledTimes(2)
    expect(m.filterNodes).not.toHaveBeenCalled()

    m.getGpus.mockClear()
    res = await callRoute(GET, { searchParams: { connId: "c1", node: "n2", refresh: "1" } })
    body = await res.json()
    expect(m.getGpus).toHaveBeenCalledTimes(1)
    expect(m.getGpus.mock.calls[0][2]).toEqual({ refresh: true })
    expect(body.data.devices.map((d: any) => d.node)).toEqual(["n2"])
  })

  it("restricted user: node.view and vm.view filter the report", async () => {
    m.getRBACContext.mockResolvedValue({ isAdmin: false, tenantId: "default", userId: "u2" })
    m.filterNodes.mockImplementation(async (_p: any, list: any[]) => list.filter((n) => n.node === "n1"))
    m.filterVms.mockImplementation(async (_p: any, list: any[]) => list.filter((v) => v.vmid === "200"))
    const body = await (await callRoute(GET)).json()
    expect(m.filterNodes.mock.calls[0][0]).toBe("u2")
    expect(m.filterVms.mock.calls[0][1]).toEqual([
      { connId: "c1", node: "n1", type: "qemu", vmid: "100", tags: [], pool: null },
      { connId: "c1", node: "n2", type: "qemu", vmid: "200", tags: [], pool: "tenant-pool" },
    ])
    expect(body.data.devices.map((d: any) => d.node)).toEqual(["n1"])
    expect(body.data.allocations.map((a: any) => [a.vmid, a.hidden])).toEqual([[null, true], ["200", false]])
  })

  it("vDC tenant: a 404, nothing read from Proxmox (GPUs are an infrastructure concern)", async () => {
    m.getInfra.mockResolvedValue({
      kind: "iaas",
      vdcScope: { connectionIds: new Set(["c1"]), poolsByConnection: new Map([["c1", new Set(["tenant-pool"])]]) },
    })
    m.getRBACContext.mockResolvedValue({ isAdmin: false, tenantId: "t1", userId: "u3" })
    const res = await callRoute(GET)
    expect(res.status).toBe(404)
    expect(m.getGpus).not.toHaveBeenCalled()
  })

  it("MSP tenant: its own connections through the session client", async () => {
    m.getInfra.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c9"]) })
    m.sessionFindMany.mockResolvedValue([{ id: "c1", name: "PROD", tenantId: "t1" }])
    const body = await (await callRoute(GET)).json()
    expect(m.globalFindMany).not.toHaveBeenCalled()
    expect(body.data.scope).toBe("infrastructure")
  })

  it("turns a connection that cannot be loaded into an error row", async () => {
    m.getConnById.mockRejectedValueOnce(new Error("decrypt failed"))
    const body = await (await callRoute(GET)).json()
    expect(body.data.connections.find((c: any) => c.id === "c1")?.error).toBe("decrypt failed")
  })

  it("answers 500 when the connection list fails", async () => {
    m.globalFindMany.mockRejectedValue(new Error("db down"))
    const res = await callRoute(GET)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe("db down")
  })
})
