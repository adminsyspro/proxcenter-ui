/**
 * Task 13: check-image read guard (spec §5.3).
 *  - iaas tenants may only probe storages inside their vDC union scope --
 *    without this guard a tenant could enumerate content on any storage on
 *    the connection by walking imageSlug/storage combinations.
 *  - provider (and msp, which is not iaas) sees no scope guard here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getCurrentTenantIdMock = vi.fn<() => Promise<string>>()
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()
const findCustomImageForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { VM_VIEW: "vm.view" },
}))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: pveFetchMock }))
vi.mock("@/lib/templates/catalogStore", () => ({
  resolveBuiltInImage: async (slug: string) =>
    slug === "ubuntu-2404"
      ? {
          slug: "ubuntu-2404",
          downloadUrl: "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img",
        }
      : undefined,
}))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: () => getCurrentTenantIdMock() }))
vi.mock("@/lib/templates/customImageScope", () => ({
  findCustomImageForTenant: (...a: any[]) => findCustomImageForTenantMock(...a),
}))
vi.mock("@/lib/templates/cloudImages", () => ({
  customImageToCloudImage: (row: any) => ({ slug: row.slug, downloadUrl: "https://img.test/custom.qcow2" }),
}))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: (...a: any[]) => getTenantInfrastructureScopeMock(...a),
}))

/** iaas union scope with the given per-connection allowed storages. */
function iaasScope(storages: string[]) {
  return {
    kind: "iaas",
    vdcScope: {
      storagesByConnection: new Map([["conn-1", new Set(storages)]]),
    },
  }
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "conn-1" })
  pveFetchMock.mockReset().mockResolvedValue([])
  getCurrentTenantIdMock.mockReset().mockResolvedValue("default")
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: "provider" })
  findCustomImageForTenantMock.mockReset().mockResolvedValue(null)
})

describe("GET /api/v1/templates/check-image -- storage scope guard (Task 13)", () => {
  it("iaas: storage outside the vDC allow-list is refused with 403, no PVE call", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(["ceph-vdc"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET, {
      searchParams: {
        connectionId: "conn-1",
        node: "node1",
        storage: "local-lvm",
        imageSlug: "ubuntu-2404",
      },
    })

    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toMatch(/not authorised/i)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("iaas: storage inside the vDC allow-list is accepted (200)", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(["ceph-vdc"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET, {
      searchParams: {
        connectionId: "conn-1",
        node: "node1",
        storage: "ceph-vdc",
        imageSlug: "ubuntu-2404",
      },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalled()
  })

  it("provider: no scope guard applied, any storage is accepted (200)", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: "provider" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, {
      searchParams: {
        connectionId: "conn-1",
        node: "node1",
        storage: "any-storage",
        imageSlug: "ubuntu-2404",
      },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalled()
  })
})

// The route used to resolve built-in images only, so a custom slug, shared or
// not, could never be probed even though the catalogue offered it and the
// deploy route accepted it.
describe("GET /api/v1/templates/check-image -- custom image resolution", () => {
  it("falls back to the caller scope when the slug is not built-in", async () => {
    findCustomImageForTenantMock.mockResolvedValue({ tenantId: "default", slug: "custom-fortigate", isShared: true })

    const { GET } = await import("./route")
    const res = await callRoute(GET, {
      searchParams: { connectionId: "conn-1", node: "node1", storage: "any-storage", imageSlug: "custom-fortigate" },
    })

    expect(res.status).toBe(200)
    expect(findCustomImageForTenantMock).toHaveBeenCalledWith("default", "custom-fortigate")
  })

  it("still refuses a slug that is neither built-in nor in scope", async () => {
    findCustomImageForTenantMock.mockResolvedValue(null)

    const { GET } = await import("./route")
    const res = await callRoute(GET, {
      searchParams: { connectionId: "conn-1", node: "node1", storage: "any-storage", imageSlug: "nope" },
    })

    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toBe("Unknown image slug")
  })

  it("does not consult the custom scope when the slug is built-in", async () => {
    const { GET } = await import("./route")
    const res = await callRoute(GET, {
      searchParams: { connectionId: "conn-1", node: "node1", storage: "any-storage", imageSlug: "ubuntu-2404" },
    })

    expect(res.status).toBe(200)
    expect(findCustomImageForTenantMock).not.toHaveBeenCalled()
  })
})
