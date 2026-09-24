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
  tenantFindManyMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  guestPerimeterAllowsMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  getTenantInfrastructureScopeMock: vi.fn(),
  maskingScopeMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
  tenantFindManyMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  guestPerimeterAllows: (...a: any[]) => guestPerimeterAllowsMock(...a),
  PERMISSIONS: { STORAGE_CONTENT: "storage.content", VM_VIEW: "vm.view" },
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
// Ownership of `custom-*` files is resolved through loadTenantSlugs
// (prisma.tenant.findMany), the real helper running on this mock.
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: (...a: any[]) => tenantFindUniqueMock(...a),
      findMany: (...a: any[]) => tenantFindManyMock(...a),
    },
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
  tenantFindManyMock.mockReset().mockResolvedValue([
    { id: "provider-tenant", slug: "provider" },
    { id: "tenant-acme", slug: "acme" },
    { id: "tenant-other", slug: "other" },
  ])
})

describe("GET .../nodes/[node]/storage/[storage]/content", () => {
  // Issue #920: the gate is `storage.content`, the right the role editor
  // advertises for browsing, not `vm.view`.
  it("returns the storage listing when the caller holds storage.content", async () => {
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual(ISOS)
    expect(checkPermissionMock).toHaveBeenCalledWith("storage.content", "connection", "conn-1")
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
    expect(guestPerimeterAllowsMock).toHaveBeenCalledWith("conn-1", "storage.content")
  })
})

// #894: on a storage granted as an ISO library the provider's catalogue (files
// without a `custom-` prefix) is visible to every vDC holding the grant, while
// tenant uploads (`custom-<slug>-*`) stay visible to their owner only. On a
// plain vDC storage the pre-existing owner-only filter is unchanged.
describe("GET .../content — tenant scope with an ISO library (#894)", () => {
  const LISTING = [
    { volid: "lib:iso/debian.iso", content: "iso" },
    { volid: "lib:iso/custom-acme-own.iso", content: "iso" },
    { volid: "lib:iso/custom-other-x.iso", content: "iso" },
    { volid: "lib:vm-100-disk-0", content: "images" },
  ]
  // `storage:iso/file.iso` -> `file.iso`, `storage:vm-100-disk-0` -> `vm-100-disk-0`
  const names = (data: any[]) => data.map((i) => String(i.volid).replace(/^[^:]+:/, "").split("/").pop())

  function tenantScope() {
    return {
      nodesByConnection: new Map([["conn-1", new Set(["pve1"])]]),
      storagesByConnection: new Map([["conn-1", new Set(["data", "lib"])]]),
      writableStoragesByConnection: new Map([["conn-1", new Set(["data"])]]),
      isoLibrariesByConnection: new Map([["conn-1", new Set(["lib"])]]),
    }
  }

  beforeEach(() => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-acme")
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: "iaas", vdcScope: tenantScope() })
    maskingScopeMock.mockReturnValue(tenantScope())
    tenantFindUniqueMock.mockResolvedValue({ slug: "acme" })
    pveFetchMock.mockResolvedValue(LISTING)
  })

  it("on the library: keeps provider files and the tenant's own uploads, drops another tenant's uploads and every non-ISO item", async () => {
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: { ...PARAMS, storage: "lib" }, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    // `lib` is reached only through the library grant: its VM images are not listed.
    expect(names(json.data)).toEqual(["debian.iso", "custom-acme-own.iso"])
  })

  it("on the library: backups and templates never surface either, and a custom- file with no known owner stays hidden", async () => {
    pveFetchMock.mockResolvedValue([
      ...LISTING,
      { volid: "lib:backup/vzdump-qemu-100.vma.zst", content: "backup" },
      { volid: "lib:vztmpl/debian-12.tar.zst", content: "vztmpl" },
      { volid: "lib:iso/custom-nobody-x.iso", content: "iso" },
    ])
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: { ...PARAMS, storage: "lib" }, searchParams: QUERY })
    expect(names((await res.json()).data)).toEqual(["debian.iso", "custom-acme-own.iso"])
  })

  it("resolves ownership on the LONGEST slug: acme does not see custom-acme-prod-x.iso", async () => {
    tenantFindManyMock.mockResolvedValue([
      { id: "tenant-acme", slug: "acme" },
      { id: "tenant-acme-prod", slug: "acme-prod" },
    ])
    pveFetchMock.mockResolvedValue([
      { volid: "lib:iso/custom-acme-prod-x.iso", content: "iso" },
      { volid: "lib:iso/custom-acme-y.iso", content: "iso" },
    ])
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: { ...PARAMS, storage: "lib" }, searchParams: QUERY })
    expect(names((await res.json()).data)).toEqual(["custom-acme-y.iso"])
  })

  it("403s on a node outside the vDC without calling PVE (per-node storages exist everywhere)", async () => {
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: { ...PARAMS, node: "pve9", storage: "lib" }, searchParams: QUERY })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/Node not accessible/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("on a plain vDC storage: only the tenant's own uploads survive among the ISOs", async () => {
    pveFetchMock.mockResolvedValue(LISTING.map((i) => ({ ...i, volid: i.volid.replace(/^lib:/, "data:") })))

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: { ...PARAMS, storage: "data" }, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(names(json.data)).toEqual(["custom-acme-own.iso", "vm-100-disk-0"])
  })

  it("403s on a storage outside the tenant scope without calling PVE", async () => {
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: { ...PARAMS, storage: "elsewhere" }, searchParams: QUERY })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("tolerates a scope without the library map (pre-#894 shape): owner-only filter applies", async () => {
    const legacy = { storagesByConnection: new Map([["conn-1", new Set(["lib"])]]) }
    maskingScopeMock.mockReturnValue(legacy)

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: { ...PARAMS, storage: "lib" }, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(names(json.data)).toEqual(["custom-acme-own.iso", "vm-100-disk-0"])
  })
})
