import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../../__tests__/setup/route-test"

const { globalFindMany, getInfraMock, getConnByIdMock, pveFetchMock, getSettingMock, getRBACContextMock, filterVmsMock, checkPermissionMock } = vi.hoisted(() => ({
  globalFindMany: vi.fn(),
  getInfraMock: vi.fn(),
  getConnByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getSettingMock: vi.fn(),
  getRBACContextMock: vi.fn(),
  filterVmsMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

// Real inventoryConnectionPlan + maskingScope, only the scope lookup is stubbed.
vi.mock("@/lib/tenant/infraScope", async orig => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { findMany: globalFindMany } }),
  getCurrentTenantId: async () => "default",
}))

vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: { findMany: globalFindMany } } }))
vi.mock("@/lib/db/settings", () => ({ getSetting: (...a: any[]) => getSettingMock(...a) }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: (...a: any[]) => getConnByIdMock(...a) }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  getRBACContext: () => getRBACContextMock(),
  filterVmsByPermission: (...a: any[]) => filterVmsMock(...a),
  PERMISSIONS: { VM_VIEW: "vm.view" },
}))

const NOW_S = Math.floor(Date.now() / 1000)

/** A two-node cluster: one all-but-101 job, one job pinned to pve2, a disabled pool job. */
const CLUSTER: Record<string, any> = {
  "/cluster/resources?type=vm": [
    { type: "qemu", vmid: 100, node: "pve1", name: "web", status: "running" },
    { type: "qemu", vmid: 101, node: "pve1", name: "db", status: "running", tags: "prod" },
    { type: "lxc", vmid: 102, node: "pve1", name: "ct-new", status: "running" },
    { type: "qemu", vmid: 103, node: "pve1", name: "tpl", status: "stopped", template: 1 },
    { type: "qemu", vmid: 104, node: "pve1", name: "opt-out", status: "stopped", tags: "no-backup;lab" },
    { type: "qemu", vmid: 105, node: "pve1", name: "fresh", status: "running" },
    { type: "lxc", vmid: 106, node: "pve1", name: "pool-ct", status: "stopped", pool: "tenantA" },
  ],
  "/cluster/backup": [
    { id: "backup-all", all: 1, exclude: "101,102,104,105,106", storage: "pbs" },
    { id: "backup-n2", vmid: "102", node: "pve2", storage: "pbs" },
    { id: "backup-pool", pool: "tenantA", enabled: 0, storage: "pbs" },
  ],
  "/nodes": [{ node: "pve1", status: "online" }, { node: "pve2", status: "online" }],
  "/nodes/pve1/qemu/101/config": { meta: `creation-qemu=9.0.2,ctime=${NOW_S - 30 * 86400}` },
  "/nodes/pve1/qemu/105/config": { meta: `creation-qemu=9.0.2,ctime=${NOW_S - 3600}` },
  "/cluster/tasks": [{ type: "vzcreate", id: "102", starttime: NOW_S - 7200 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getInfraMock.mockResolvedValue({ kind: "provider" })
  globalFindMany.mockResolvedValue([{ id: "c1", name: "Cluster 1", tenantId: "default" }])
  getConnByIdMock.mockResolvedValue({ baseUrl: "https://pve", apiToken: "tok" })
  getSettingMock.mockResolvedValue(null)
  getRBACContextMock.mockResolvedValue({ isAdmin: true, tenantId: "default", userId: "admin" })
  filterVmsMock.mockImplementation(async (_p: any, list: any[]) => list)
  pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (path in CLUSTER) return CLUSTER[path]
    throw new Error(`unexpected ${path}`)
  })
})

async function get(searchParams?: Record<string, string>) {
  const { GET } = await import("./route")
  const res = await callRoute(GET, { method: "GET", searchParams })
  return { status: res.status, body: await res.json() }
}

describe("GET /api/v1/backups/coverage", () => {
  it("lists the uncovered guests with their reason, honouring templates, tag and grace", async () => {
    const { status, body } = await get()
    expect(status).toBe(200)

    const rows = body.data.guests.map((g: any) => [g.vmid, g.reason, g.jobIds])
    // 100 covered, 103 template, 104 tagged, 102 (2 h) and 105 (1 h) inside the 24 h grace.
    expect(rows).toEqual([
      ["101", "excluded", ["backup-all"]],
      ["106", "excluded", ["backup-all"]],
    ])
    expect(body.data.summary).toEqual({ total: 6, covered: 1, uncovered: 2, ignored: { template: 1, tag: 1, grace: 2 } })
    expect(body.data.guests[0]).toMatchObject({ connectionName: "Cluster 1", node: "pve1", nodeStatus: "online", type: "qemu", tags: ["prod"] })
    expect(body.data.settings).toEqual({ graceHours: 24, excludeTag: "no-backup" })
  })

  it("only reads the configs of the uncovered guests, and the task list for the container", async () => {
    await get()
    const paths = pveFetchMock.mock.calls.map(c => c[1])
    expect(paths).toEqual(expect.arrayContaining(["/nodes/pve1/qemu/101/config", "/nodes/pve1/qemu/105/config", "/cluster/tasks"]))
    expect(paths).not.toContain("/nodes/pve1/qemu/100/config")
    expect(paths).not.toContain("/nodes/pve1/qemu/104/config")
    expect(paths.filter(p => p.includes("/lxc/"))).toEqual([])
  })

  it("applies the stored settings: no grace, another tag", async () => {
    getSettingMock.mockResolvedValue({ backup_coverage_grace_hours: 0, backup_coverage_exclude_tag: "lab" })
    const { body } = await get()
    const reasons = Object.fromEntries(body.data.guests.map((g: any) => [g.vmid, g.reason]))
    expect(reasons).toEqual({ "101": "excluded", "102": "excluded", "105": "excluded", "106": "excluded" })
    expect(body.data.summary.ignored).toEqual({ template: 1, tag: 1, grace: 0 })
    // Grace off: no creation time lookup at all.
    expect(pveFetchMock.mock.calls.map(c => c[1])).not.toContain("/cluster/tasks")
  })

  it("reports a node-restricted job and a disabled job once the all-job exclusion is gone", async () => {
    getSettingMock.mockResolvedValue({ backup_coverage_grace_hours: 0 })
    const jobs = CLUSTER["/cluster/backup"]
    pveFetchMock.mockImplementation(async (_c: any, path: string) =>
      path === "/cluster/backup" ? jobs.slice(1) : CLUSTER[path],
    )
    const { body } = await get()
    const reasons = Object.fromEntries(body.data.guests.map((g: any) => [g.vmid, [g.reason, g.jobIds]]))
    expect(reasons["102"]).toEqual(["other_node", ["backup-n2"]])
    expect(reasons["106"]).toEqual(["disabled_job", ["backup-pool"]])
    expect(reasons["100"]).toEqual(["not_selected", []])
  })

  it("filters the guests through RBAC before resolving anything", async () => {
    getRBACContextMock.mockResolvedValue({ isAdmin: false, tenantId: "default", userId: "u1" })
    filterVmsMock.mockImplementation(async (_p: any, list: any[]) => list.filter(g => g.vmid === "101"))
    const { body } = await get()
    expect(filterVmsMock).toHaveBeenCalledWith("u1", expect.any(Array), "vm.view", "default")
    expect(body.data.guests.map((g: any) => g.vmid)).toEqual(["101"])
    expect(body.data.summary.total).toBe(1)
    expect(pveFetchMock.mock.calls.map(c => c[1])).not.toContain("/nodes/pve1/qemu/105/config")
  })

  it("restricts a vDC tenant to its pools and hides the provider job ids", async () => {
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: { connectionIds: new Set(["c1"]), poolsByConnection: new Map([["c1", new Set(["tenantA"])]]) },
    })
    const { body } = await get()
    expect(body.data.guests.map((g: any) => [g.vmid, g.jobIds])).toEqual([["106", []]])
  })

  it("reports a connection whose jobs cannot be read instead of flagging all its guests", async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === "/cluster/backup") throw new Error("HTTP 403")
      return CLUSTER[path]
    })
    const { body } = await get()
    expect(body.data.guests).toEqual([])
    expect(body.data.errors).toEqual([{ connId: "c1", connectionName: "Cluster 1", error: "HTTP 403" }])
  })

  it("returns the permission refusal as is", async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }))
    const { status } = await get()
    expect(status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
