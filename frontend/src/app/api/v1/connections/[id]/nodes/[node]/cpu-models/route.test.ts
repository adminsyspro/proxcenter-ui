import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, getConnectionByIdMock, pveFetchMock, guestPerimeterAllowsMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  guestPerimeterAllowsMock: vi.fn(),
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

const PARAMS = { id: "conn-1", node: "pve1" }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  // Flat-scoped fallback off by default: the denial path stays the denial path.
  guestPerimeterAllowsMock.mockReset().mockResolvedValue(false)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "c", baseUrl: "https://x:8006", apiToken: "t" })
  pveFetchMock.mockReset()
})

describe("GET .../nodes/[node]/cpu-models", () => {
  it("returns the CPU model list from the node's QEMU capabilities", async () => {
    const models = [{ name: "kvm64" }, { name: "custom-foo", custom: 1 }]
    pveFetchMock.mockResolvedValue(models)
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data).toEqual(models)
    expect(pveFetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("/capabilities/qemu/cpu")
    )
  })

  it("returns an empty list when PVE responds with a non-array payload", async () => {
    pveFetchMock.mockResolvedValue(null)
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data).toEqual([])
  })

  it("returns the RBAC denial without calling PVE when permission is denied", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS })
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  // Issue #262: a pool-scoped user matches no node resource, so the CPU tab of
  // the creation wizard needs the guest-derived fallback to answer.
  it("serves a flat-scoped caller whose guests live on this cluster", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    guestPerimeterAllowsMock.mockResolvedValue(true)
    pveFetchMock.mockResolvedValue([{ name: "kvm64" }])
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS })
    expect(res.status).toBe(200)
    expect(guestPerimeterAllowsMock).toHaveBeenCalledWith("conn-1", "node.view")
  })

  it("returns 500 with an error message when the PVE call fails", async () => {
    pveFetchMock.mockRejectedValue(new Error("boom"))
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS })
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toBeDefined()
  })
})
