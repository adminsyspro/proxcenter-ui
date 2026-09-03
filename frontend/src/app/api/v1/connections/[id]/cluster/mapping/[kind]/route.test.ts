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
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", VM_VIEW: "vm.view" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))

async function get(kind: string, searchParams?: Record<string, string>) {
  const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
  const res = await callRoute(GET, { params: { id: "conn-1", kind }, searchParams })

  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  guestPerimeterAllowsMock.mockReset().mockResolvedValue(false)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "c", baseUrl: "https://x:8006", apiToken: "t" })
  pveFetchMock.mockReset()
})

// Resource mappings are the only passthrough route open to an API token (#852).
describe("GET .../cluster/mapping/[kind]", () => {
  it("lists the USB mappings PVE lets the token see", async () => {
    const mappings = [{ id: "tablet", map: ["node=pve1,id=0627:0001"] }]
    pveFetchMock.mockResolvedValue(mappings)

    const { status, json } = await get("usb")

    expect(status).toBe(200)
    expect(json.data).toEqual(mappings)
    expect(pveFetchMock).toHaveBeenCalledWith(expect.anything(), "/cluster/mapping/usb")
  })

  it("asks PVE to check the mappings against the node when one is given", async () => {
    pveFetchMock.mockResolvedValue([])

    await get("pci", { node: "pve 1" })

    expect(pveFetchMock).toHaveBeenCalledWith(expect.anything(), "/cluster/mapping/pci?check-node=pve%201")
  })

  it("rejects an unknown mapping kind before touching PVE", async () => {
    const { status, json } = await get("dir")

    expect(status).toBe(400)
    expect(json.error).toMatch(/Unknown mapping kind/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("returns the RBAC denial without calling PVE when permission is denied", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))

    const { status } = await get("usb")

    expect(status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("serves a guest-scoped caller whose VMs live on this cluster", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    guestPerimeterAllowsMock.mockResolvedValue(true)
    pveFetchMock.mockResolvedValue([{ id: "gpu" }])

    const { status, json } = await get("pci")

    expect(status).toBe(200)
    expect(json.data).toEqual([{ id: "gpu" }])
    expect(guestPerimeterAllowsMock).toHaveBeenCalledWith("conn-1", "vm.view")
  })

  it("returns an empty list when PVE answers with a non-array payload", async () => {
    pveFetchMock.mockResolvedValue(null)

    const { status, json } = await get("usb")

    expect(status).toBe(200)
    expect(json.data).toEqual([])
  })

  it("returns 500 with the PVE error message when the call fails", async () => {
    pveFetchMock.mockRejectedValue(new Error("PVE 501 /cluster/mapping/usb: not implemented"))

    const { status, json } = await get("usb")

    expect(status).toBe(500)
    expect(json.error).toMatch(/not implemented/)
  })
})
