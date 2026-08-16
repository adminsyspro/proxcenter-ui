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
  tenantFindUniqueMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  guestPerimeterAllowsMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  getTenantInfrastructureScopeMock: vi.fn(),
  maskingScopeMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  guestPerimeterAllows: (...a: any[]) => guestPerimeterAllowsMock(...a),
  PERMISSIONS: { VM_VIEW: "vm.view" },
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
    tenant: { findUnique: (...a: any[]) => tenantFindUniqueMock(...a) },
  },
}))

const PARAMS = { id: "conn-1", node: "pve1", storage: "local" }
const QUERY = { content: "iso" }
const ISOS = [{ volid: "local:iso/debian.iso", content: "iso" }]

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  // Flat-scoped fallback off by default: the denial path stays the denial path.
  guestPerimeterAllowsMock.mockReset().mockResolvedValue(false)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "c", baseUrl: "https://x:8006", apiToken: "t" })
  pveFetchMock.mockReset().mockResolvedValue(ISOS)
  getCurrentTenantIdMock.mockReset().mockResolvedValue("provider-tenant")
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: "provider" })
  // provider: no vDC mask, so neither the storage gate nor the slug lookup runs.
  maskingScopeMock.mockReset().mockReturnValue(null)
  tenantFindUniqueMock.mockReset().mockResolvedValue({ slug: "acme" })
})

describe("GET .../nodes/[node]/storage/[storage]/content", () => {
  it("returns the storage listing when the caller holds vm.view", async () => {
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual(ISOS)
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

  // Issue #262: a pool-scoped user matches no connection resource, so the ISO
  // picker of the creation wizard needs the guest-derived fallback to answer.
  it("serves a flat-scoped caller whose guests live on this cluster", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    guestPerimeterAllowsMock.mockResolvedValue(true)

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual(ISOS)
    expect(guestPerimeterAllowsMock).toHaveBeenCalledWith("conn-1", "vm.view")
  })
})
