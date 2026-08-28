/**
 * Task 15 (security): GET /api/v1/pbs/[id]/jobs used to have NO scoping at
 * all beyond the RBAC permission check -- any tenant with a vDC binding on
 * a shared PBS connection could list every sync/verify/prune/GC/tape job on
 * it, across every namespace of every tenant. These tests pin the fix
 * (mirrors GET /api/v1/pbs/[id]/backups): assertVdcPbsAccess gates access,
 * admin/msp callers are unrestricted, and iaas tenants only see jobs whose
 * (datastore, namespace) pair is in BOTH their union access list AND the
 * narrowed (active vDC view context) scope.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const {
  checkPermissionMock, assertVdcPbsAccessMock, getVdcScopeMock,
  getPbsConnectionByIdMock, getPbsConnectionByIdUnscopedMock, pbsFetchMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  assertVdcPbsAccessMock: vi.fn(),
  getVdcScopeMock: vi.fn(),
  getPbsConnectionByIdMock: vi.fn(),
  getPbsConnectionByIdUnscopedMock: vi.fn(),
  pbsFetchMock: vi.fn(),
}))

vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: () => null }))

vi.mock("@/lib/proxmox/pbs-client", () => ({
  pbsFetch: (...a: any[]) => pbsFetchMock(...a),
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getPbsConnectionById: (...a: any[]) => getPbsConnectionByIdMock(...a),
  getPbsConnectionByIdUnscoped: (...a: any[]) => getPbsConnectionByIdUnscopedMock(...a),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { BACKUP_JOB_VIEW: "backup.job.view" },
}))

vi.mock("@/lib/vdc/scope", () => ({
  assertVdcPbsAccess: (...a: any[]) => assertVdcPbsAccessMock(...a),
  getVdcScope: (...a: any[]) => getVdcScopeMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-a"),
}))

const CONN = { id: "pbs-1", baseUrl: "https://pbs.local:8007" }

function mockPbsData() {
  pbsFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (path === "/admin/datastore") return [{ store: "store1" }, { store: "store2" }]
    if (path === "/admin/sync") {
      return [
        { id: "sync1", store: "store1", ns: "ns-a" },
        { id: "sync2", store: "store1", ns: "ns-b" },
        { id: "sync3", store: "store2", ns: "" },
      ]
    }
    if (path === "/admin/verify") return []
    if (path === "/config/tape-backup-job") return []
    if (path === "/admin/prune") {
      return [
        { id: "prune-store1", store: "store1", ns: "ns-a" },
        { id: "prune-store2", store: "store2", ns: "" },
      ]
    }
    if (path.startsWith("/admin/datastore/") && path.endsWith("/gc")) {
      if (path.includes("store1")) return { schedule: "daily" }
      if (path.includes("store2")) return { schedule: "weekly" }
      return {}
    }
    throw new Error(`unexpected path ${path}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getPbsConnectionByIdMock.mockResolvedValue(CONN)
  getPbsConnectionByIdUnscopedMock.mockResolvedValue(CONN)
  mockPbsData()
})

describe("GET /api/v1/pbs/[id]/jobs — access verdict", () => {
  it("denies (403 passthrough) when assertVdcPbsAccess rejects", async () => {
    assertVdcPbsAccessMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "PBS not accessible for this tenant" }), { status: 403 })
    )

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { params: { id: "pbs-1" } })
    expect(res.status).toBe(403)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it("admin (super-admin / msp): no namespace filtering, sees every job across every datastore", async () => {
    assertVdcPbsAccessMock.mockResolvedValue({ kind: "admin" })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { params: { id: "pbs-1" } })
    expect(res.status).toBe(200)

    const body = await res.json()
    const allIds = body.data.jobs.all.map((j: any) => j.id)
    expect(allIds).toEqual(
      expect.arrayContaining(["sync1", "sync2", "sync3", "prune-store1", "prune-store2", "gc-store1", "gc-store2"])
    )
    expect(body.data.datastores).toEqual(["store1", "store2"])
  })

  it("admin: a /admin/prune failure leaves the other job types listed", async () => {
    assertVdcPbsAccessMock.mockResolvedValue({ kind: "admin" })
    const base = pbsFetchMock.getMockImplementation()!

    pbsFetchMock.mockImplementation(async (conn: any, path: string) => {
      if (path === "/admin/prune") throw new Error("PBS 403 /admin/prune")

      return base(conn, path)
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { params: { id: "pbs-1" } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.jobs.prune).toEqual([])
    expect(body.data.jobs.sync.map((j: any) => j.id)).toEqual(["sync1", "sync2", "sync3"])
  })

  it("iaas tenant: only jobs whose (datastore, namespace) is in the union ∩ narrowed scope are returned", async () => {
    assertVdcPbsAccessMock.mockResolvedValue({
      kind: "tenant",
      allowed: [{ datastore: "store1", namespace: "ns-a" }],
    })
    getVdcScopeMock.mockResolvedValue({
      pbsNamespacesByConnection: new Map([["pbs-1", [{ datastore: "store1", namespace: "ns-a" }]]]),
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { params: { id: "pbs-1" } })
    expect(res.status).toBe(200)

    const body = await res.json()
    const allIds = body.data.jobs.all.map((j: any) => j.id)
    expect(allIds).toContain("sync1")
    expect(allIds).toContain("prune-store1")
    expect(allIds).toContain("gc-store1")
    // Different namespace on the same allowed datastore -> denied.
    expect(allIds).not.toContain("sync2")
    // Different (foreign) datastore entirely -> denied.
    expect(allIds).not.toContain("sync3")
    expect(allIds).not.toContain("prune-store2")
    expect(allIds).not.toContain("gc-store2")
    // Datastore list returned to the client never leaks the foreign name.
    expect(body.data.datastores).toEqual(["store1"])
  })

  it("iaas tenant: a union-allowed pair outside the CURRENT vDC view context is still denied (narrowed, not union)", async () => {
    assertVdcPbsAccessMock.mockResolvedValue({
      kind: "tenant",
      allowed: [{ datastore: "store1", namespace: "ns-a" }],
    })
    // Union says yes, but the active vDC view context has nothing bound here.
    getVdcScopeMock.mockResolvedValue({
      pbsNamespacesByConnection: new Map(),
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { params: { id: "pbs-1" } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.jobs.all).toEqual([])
    expect(body.data.datastores).toEqual([])
  })
})
