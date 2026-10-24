import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const {
  checkPermissionMock,
  getConnectionByIdMock,
  pveFetchMock,
  guestPerimeterAllowsMock,
  getCurrentTenantIdMock,
  resolveVdcForTenantMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  guestPerimeterAllowsMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  resolveVdcForTenantMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  guestPerimeterAllows: (...a: any[]) => guestPerimeterAllowsMock(...a),
  buildNodeResourceId: (id: string, node: string) => `${id}/${node}`,
  PERMISSIONS: { NODE_VIEW: "node.view" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: () => getCurrentTenantIdMock(),
}))
vi.mock("@/lib/vdc/quota", () => ({
  resolveVdcForTenant: (...a: any[]) => resolveVdcForTenantMock(...a),
}))

const PARAMS = { id: "conn-1", node: "pve1" }

// Shape of PVE 9.2's /nodes/{node}/capabilities/qemu/machines, trimmed.
const capabilities = [
  { id: "pc-i440fx-11.0+pve2", type: "i440fx", version: "11.0+pve2", changes: "Enable hv_emcs for Windows." },
  { id: "pc-q35-11.0+pve2", type: "q35", version: "11.0+pve2", changes: "Enable hv_emcs for Windows." },
  { id: "pc-q35-10.1", type: "q35", version: "10.1" },
  { id: "virt-10.1", type: "virt", version: "10.1" },
  { type: "q35", version: "broken" },
]

async function get() {
  const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]

  return callRoute(GET, { params: PARAMS })
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  guestPerimeterAllowsMock.mockReset().mockResolvedValue(false)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "c", baseUrl: "https://x:8006", apiToken: "t" })
  pveFetchMock.mockReset().mockResolvedValue(capabilities)
  getCurrentTenantIdMock.mockReset().mockResolvedValue("default")
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
})

describe("GET .../nodes/[node]/machines", () => {
  it("returns the i440fx and q35 machine versions of the node, newest first", async () => {
    const res = await get()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledWith(expect.anything(), "/nodes/pve1/capabilities/qemu/machines")
    expect(json.data).toEqual([
      { id: "pc-i440fx-11.0+pve2", type: "i440fx", version: "11.0+pve2", changes: "Enable hv_emcs for Windows." },
      { id: "pc-q35-11.0+pve2", type: "q35", version: "11.0+pve2", changes: "Enable hv_emcs for Windows." },
      { id: "pc-q35-10.1", type: "q35", version: "10.1", changes: null },
    ])
  })

  it("falls back to the id when PVE omits the version", async () => {
    pveFetchMock.mockResolvedValue([{ id: "pc-q35-9.0", type: "q35" }])
    const json = await (await get()).json()

    expect(json.data).toEqual([{ id: "pc-q35-9.0", type: "q35", version: "pc-q35-9.0", changes: null }])
  })

  it("returns an empty list when PVE answers with a non-array payload", async () => {
    pveFetchMock.mockResolvedValue(null)
    const json = await (await get()).json()

    expect(json.data).toEqual([])
  })

  it("refuses a caller without node view and outside any guest perimeter", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    const res = await get()

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("serves a flat-scoped caller whose guest perimeter covers the connection", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    guestPerimeterAllowsMock.mockResolvedValue(true)
    const res = await get()

    expect(res.status).toBe(200)
  })

  it("refuses a node outside the tenant's vDC", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    resolveVdcForTenantMock.mockRejectedValue(new Error("NODE_NOT_AUTHORIZED"))
    const res = await get()

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("answers 500 when PVE fails", async () => {
    pveFetchMock.mockRejectedValue(new Error("boom"))
    const res = await get()

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe("boom")
  })
})
