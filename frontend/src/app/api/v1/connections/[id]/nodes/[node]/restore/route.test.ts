import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

// Hoisted mocks -- referenced from vi.mock factories below, which vitest
// hoists above these imports/consts, so they must themselves be created
// via vi.hoisted().
const {
  getConnectionByIdMock,
  getInfraMock,
  checkPermissionMock,
  pveFetchMock,
  resolveVdcForTenantMock,
  getCurrentTenantIdMock,
} = vi.hoisted(() => ({
  getConnectionByIdMock: vi.fn(),
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  pveFetchMock: vi.fn(),
  resolveVdcForTenantMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
}))

// The route schedules post-restore work (waitForTask, pool placement, IPAM
// sync) via next/server's after(). We only care about the synchronous
// response + the immediate PVE POST, so after() is stubbed to a no-op that
// never runs its callback -- keeping NextResponse itself real.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>()
  return { ...actual, after: vi.fn() }
})

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: pveFetchMock }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: () => checkPermissionMock(),
  buildNodeResourceId: (...a: any[]) => a.join(":"),
  PERMISSIONS: { VM_BACKUP: "vm.backup" },
}))
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: () => getCurrentTenantIdMock(),
  DEFAULT_TENANT_ID: "default",
}))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))
vi.mock("@/lib/vdc/quota", () => ({
  resolveVdcForTenant: (...a: any[]) => resolveVdcForTenantMock(...a),
}))
// Only exercised by the pbsBackup path, which none of these tests take.
vi.mock("@/lib/vdc/scope", () => ({ assertVdcPbsAccess: vi.fn() }))
// Guards prisma.vdc.findFirst (pool-placement lookup, isTenant only) and
// prisma.connection.findUnique (pbsBackup path, unused here) from hitting a
// real database.
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    vdc: { findFirst: vi.fn().mockResolvedValue(null) },
    connection: { findUnique: vi.fn() },
  },
}))
// Dynamically imported by the route (`await import("@/lib/audit")`); vi.mock
// intercepts dynamic imports too.
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue("audit-1") }))

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({
    id: "pve-1",
    name: "pve-1",
    baseUrl: "https://pve.local:8006",
    apiToken: "t",
    insecureDev: false,
    behindProxy: false,
  })
  getCurrentTenantIdMock.mockReset().mockResolvedValue("default")
  getInfraMock.mockReset().mockResolvedValue({ kind: "provider" })
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  pveFetchMock.mockReset().mockResolvedValue("UPID:pve-1:00000000:00000000:00000000:qmrestore:111:root@pam:")
})

/** Decode the URL-encoded form body of a pveFetch(conn, path, opts) call. */
function postedParams(call: unknown[]): URLSearchParams {
  const opts = call[2] as { body?: string }
  return new URLSearchParams(opts?.body ?? "")
}

const VZDUMP_QEMU_VOLID = "local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst"
const VZDUMP_LXC_VOLID = "local:backup/vzdump-lxc-111-2026_08_11-15_51_33.tar.zst"

describe("POST /api/v1/connections/[id]/nodes/[node]/restore -- raw archive volid contract", () => {
  it("qemu: archive volid is posted as `archive` to /nodes/{node}/qemu", async () => {
    const { POST } = await import("./route")

    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_QEMU_VOLID, type: "qemu" },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)

    const call = pveFetchMock.mock.calls[0]
    expect(call[1]).toBe("/nodes/node1/qemu")
    const params = postedParams(call)
    expect(params.get("archive")).toBe(VZDUMP_QEMU_VOLID)
    expect(params.get("vmid")).toBe("111")
    expect(params.has("ostemplate")).toBe(false)
    expect(params.has("restore")).toBe(false)
  })

  it("lxc: archive volid is posted as `ostemplate` with restore=1 to /nodes/{node}/lxc", async () => {
    const { POST } = await import("./route")

    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_LXC_VOLID, type: "lxc" },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)

    const call = pveFetchMock.mock.calls[0]
    expect(call[1]).toBe("/nodes/node1/lxc")
    const params = postedParams(call)
    expect(params.get("ostemplate")).toBe(VZDUMP_LXC_VOLID)
    expect(params.get("restore")).toBe("1")
    expect(params.has("archive")).toBe(false)
  })

  it("iaas tenant: archive storage outside the vDC allow-list is refused, no PVE call emitted", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: {
        connectionIds: new Set(["pve-1"]),
        pbsConnectionIds: new Set<string>(),
        nodesByConnection: new Map<string, Set<string>>(),
        // Allow-listed storage is "ceph-vdc" -- deliberately does NOT
        // include "local", which is the prefix of the archive below.
        storagesByConnection: new Map([["pve-1", new Set(["ceph-vdc"])]]),
        poolsByConnection: new Map<string, Set<string>>(),
        vnetsByConnection: new Map<string, Set<string>>(),
        sharedBridgesByConnection: new Map<string, Set<string>>(),
        pbsNamespacesByConnection: new Map<string, Array<{ datastore: string; namespace: string }>>(),
        pbsNamespacesByPveConnection: new Map<string, Set<string>>(),
      },
    })
    // Tenant does have a vDC on this connection/node -- the allow-list
    // check, not the "no vDC" branch, is what must reject this request.
    resolveVdcForTenantMock.mockResolvedValue({ vdcId: "vdc-1", poolName: "pool-1", quota: null })

    const { POST } = await import("./route")
    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_QEMU_VOLID, type: "qemu" },
    })

    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toMatch(/not authorised/i)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
