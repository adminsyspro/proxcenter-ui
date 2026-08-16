import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const {
  checkPermissionMock,
  guestPerimeterAllowsMock,
  getConnectionByIdMock,
  pveFetchMock,
  getCurrentTenantIdMock,
  getTenantInfrastructureScopeMock,
  maskingScopeMock,
  connectionFindUniqueMock,
  vdcVnetFindManyMock,
  vdcSharedBridgeFindManyMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  guestPerimeterAllowsMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  getTenantInfrastructureScopeMock: vi.fn(),
  maskingScopeMock: vi.fn(),
  connectionFindUniqueMock: vi.fn(),
  vdcVnetFindManyMock: vi.fn(),
  vdcSharedBridgeFindManyMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  guestPerimeterAllows: (...a: any[]) => guestPerimeterAllowsMock(...a),
  buildNodeResourceId: (id: string, node: string) => `${id}/${node}`,
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a),
}))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: (...a: any[]) => getTenantInfrastructureScopeMock(...a),
  maskingScope: (...a: any[]) => maskingScopeMock(...a),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findUnique: (...a: any[]) => connectionFindUniqueMock(...a) },
    vdcVnet: { findMany: (...a: any[]) => vdcVnetFindManyMock(...a) },
    vdcSharedBridge: { findMany: (...a: any[]) => vdcSharedBridgeFindManyMock(...a) },
  },
}))

const PARAMS = { id: "conn-1" }
const QUERY = { node: "pve1" }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  // Flat-scoped fallback off by default: the denial path stays the denial path.
  guestPerimeterAllowsMock.mockReset().mockResolvedValue(false)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "c", baseUrl: "https://x:8006", apiToken: "t" })
  pveFetchMock.mockReset().mockImplementation((_conn: any, path: string) => {
    if (path.endsWith("/network")) {
      return Promise.resolve([{ iface: "vmbr0", type: "bridge" }])
    }
    if (path === "/cluster/sdn/vnets") return Promise.resolve([])
    return Promise.resolve([])
  })
  getCurrentTenantIdMock.mockReset().mockResolvedValue("provider-tenant")
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: "provider" })
  // provider: no vDC masking, so the route takes the full-cluster branch.
  maskingScopeMock.mockReset().mockReturnValue(null)
  connectionFindUniqueMock.mockReset().mockResolvedValue({ tenantId: "provider-tenant" })
  vdcVnetFindManyMock.mockReset().mockResolvedValue([])
  vdcSharedBridgeFindManyMock.mockReset().mockResolvedValue([])
})

describe("GET /api/v1/connections/[id]/network-choices", () => {
  it("returns the cluster bridges when the caller holds connection.view", async () => {
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual([{ kind: "bridge", name: "vmbr0", type: "bridge" }])
    // Permission granted, so the guest-derived fallback is never consulted.
    expect(guestPerimeterAllowsMock).not.toHaveBeenCalled()
  })

  it("returns the RBAC denial without calling PVE when no guest opens the perimeter", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  // Issue #262: a pool-scoped user matches no node resource, so the Network tab
  // of the creation wizard needs the guest-derived fallback to answer.
  it("serves a flat-scoped caller whose guests live on this cluster", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    guestPerimeterAllowsMock.mockResolvedValue(true)

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual([{ kind: "bridge", name: "vmbr0", type: "bridge" }])
    expect(guestPerimeterAllowsMock).toHaveBeenCalledWith("conn-1", "connection.view")
  })
})
