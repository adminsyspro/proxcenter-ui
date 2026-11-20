import { beforeEach, describe, expect, it, vi } from "vitest"

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
// The vDC guest guard (lib/vdc/guestGuard.ts) has its own tests: pass-through
// here, as for a provider session.
vi.mock("@/lib/vdc/guestGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vdc/guestGuard")>()),
  guardSessionGuest: async () => null,
}))
vi.mock("@/lib/api-tokens/routeGuard", () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute } from "../../../../../../../../../../__tests__/setup/route-test"

// Hoist mocks so they are available in vi.mock factories
const { getInfraMock, checkPermissionMock, getConnectionByIdMock, pveFetchMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => "test-tenant",
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...args: any[]) => checkPermissionMock(...args),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}/${node}/${type}/${vmid}`,
  PERMISSIONS: { VM_MIGRATE: "vm.migrate" },
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...args: any[]) => getConnectionByIdMock(...args),
}))

vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...args: any[]) => pveFetchMock(...args),
}))

vi.mock("@/lib/schemas", () => ({
  migrateVmSchema: {
    safeParse: (b: any) => ({
      success: true,
      data: { target: b?.target ?? "pve2", online: true, targetstorage: b?.targetstorage ?? null, withLocalDisks: false },
    }),
  },
}))

vi.mock("@/lib/cache/guestSetRefresh", () => ({ refreshCachedGuests: vi.fn() }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

const STUB_CONN = { id: "conn-1", baseUrl: "https://pve:8006", apiToken: "tok" }

const PARAMS = { id: "conn-1", type: "qemu", node: "pve1", vmid: "100" }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue(STUB_CONN)
  pveFetchMock.mockReset().mockResolvedValue("UPID:pve1:0:0:migrate:100:root@pam:")
  getInfraMock.mockReset()
})

describe("POST .../migrate — MSP ownership gate", () => {
  it("provider tenant passes the gate (reaches body execution, no 403)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: { target: "pve2", online: true },
    })

    expect(res.status).not.toBe(403)
  })

  it("msp tenant that owns the connection passes the gate", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-1"]) })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: { target: "pve2", online: true },
    })

    expect(res.status).not.toBe(403)
  })

  it("msp tenant that does NOT own the connection gets 403", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-other"]) })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: { target: "pve2", online: true },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/migration is restricted/i)
  })

  it("iaas tenant gets 403 regardless of connection ids", async () => {
    const vdcScope: any = { connectionIds: new Set(["conn-1"]), pbsConnectionIds: new Set() }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: { target: "pve2", online: true },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/migration is restricted/i)
  })
})

describe("POST .../migrate — snapshot guard (#1027)", () => {
  function pve(routes: Record<string, any>) {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path in routes) return routes[path]
      if (path.endsWith("/migrate")) return "UPID:pve1:0:0:migrate:100:root@pam:"
      throw new Error(`unexpected PVE call ${path}`)
    })
  }

  const HELD = {
    "/nodes/pve1/qemu/100/snapshot": [{ name: "before-upgrade" }, { name: "current" }],
    "/nodes/pve1/qemu/100/snapshot/before-upgrade/config": { scsi0: "ZFS-Pool:vm-100-disk-0,size=32G" },
    "/storage": [{ storage: "ZFS-Pool", type: "zfspool" }],
    "/cluster/replication": [],
  }

  it("refuses a running VM whose ZFS disk a snapshot holds, naming both, before calling PVE", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    pve({ ...HELD, "/nodes/pve1/qemu/100/status/current": { status: "running" } })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: { target: "pve2" } })
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("SNAPSHOTS_BLOCK_MIGRATION")
    expect(json.error).toContain("before-upgrade")
    expect(json.error).toContain("ZFS-Pool:vm-100-disk-0")
    expect(pveFetchMock.mock.calls.some(c => String(c[1]).endsWith("/migrate"))).toBe(false)
  })

  it("lets the same VM migrate once it is stopped, since ZFS carries snapshots offline", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    pve({ ...HELD, "/nodes/pve1/qemu/100/status/current": { status: "stopped" } })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: { target: "pve2" } })

    expect(res.status).toBe(200)
  })

  it("leaves the verdict to PVE when the check itself fails", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    pve({ "/nodes/pve1/qemu/100/snapshot": [{ name: "s1" }] })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: { target: "pve2" } })

    expect(res.status).toBe(200)
  })
})

describe("POST .../migrate — target storage guard (#1402)", () => {
  function pve(routes: Record<string, any>) {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path in routes) return routes[path]
      if (path.endsWith("/migrate")) return "UPID:pve1:0:0:migrate:100:root@pam:"
      throw new Error(`unexpected PVE call ${path}`)
    })
  }

  const GUEST = {
    "/nodes/pve1/qemu/100/snapshot": [{ name: "current" }],
    "/nodes/pve1/qemu/100/config": { scsi0: "ZFS-Pool:vm-100-disk-0,size=32G" },
    "/nodes/pve1/qemu/100/status/current": { status: "running" },
    "/storage": [{ storage: "ZFS-Pool", type: "zfspool" }, { storage: "ceph", type: "rbd" }],
    "/cluster/ha/resources": [],
    "/cluster/replication": [],
  }

  const migrateCalls = () => pveFetchMock.mock.calls.filter(c => String(c[1]).endsWith("/migrate"))

  async function post(body: Record<string, unknown>) {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]

    return callRoute(POST, { method: "POST", params: PARAMS, body })
  }

  it("sends the target storage to PVE for a plain guest", async () => {
    pve(GUEST)

    const res = await post({ target: "pve2", targetstorage: "ceph" })

    expect(res.status).toBe(200)
    expect(String(migrateCalls()[0][2].body)).toContain("targetstorage=ceph")
  })

  it("refuses an HA-managed guest and says which disks to move first, before calling PVE", async () => {
    pve({ ...GUEST, "/cluster/ha/resources": [{ sid: "vm:100" }] })

    const res = await post({ target: "pve2", targetstorage: "ceph" })
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("TARGET_STORAGE_NEEDS_DISK_MOVE")
    expect(json.plan).toEqual({ kind: "move-first", disks: [{ id: "scsi0", volid: "ZFS-Pool:vm-100-disk-0" }] })
    expect(json.error).toContain("scsi0")
    expect(migrateCalls()).toHaveLength(0)
  })

  it("refuses the disks replicated to the target node", async () => {
    pve({ ...GUEST, "/cluster/replication": [{ guest: 100, target: "pve2" }] })

    const res = await post({ target: "pve2", targetstorage: "ceph" })
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("TARGET_STORAGE_NOT_APPLICABLE")
    expect(json.error).toContain("ZFS-Pool:vm-100-disk-0")
    expect(migrateCalls()).toHaveLength(0)
  })

  it("migrates an HA-managed guest that keeps its storage, without reading more from PVE", async () => {
    pve({ "/nodes/pve1/qemu/100/snapshot": [{ name: "current" }] })

    const res = await post({ target: "pve2" })

    expect(res.status).toBe(200)
  })

  it("leaves the verdict to PVE when the check itself fails", async () => {
    pve({ "/nodes/pve1/qemu/100/snapshot": [{ name: "current" }] })

    const res = await post({ target: "pve2", targetstorage: "ceph" })

    expect(res.status).toBe(200)
    expect(migrateCalls()).toHaveLength(1)
  })
})
