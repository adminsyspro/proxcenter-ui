import { beforeEach, describe, expect, it, vi } from "vitest"


// The IaaS tenant gate of this route is covered by lib/tenant/iaasGuard.routes.test.ts
// and lib/connections/iaasView.routes.test.ts (roadmap#189); the caller here is the provider.
vi.mock("@/lib/tenant/iaasGuard", () => ({
  denyIaasTenant: async () => null,
  resolveCallerInfraScope: () => callerMock(),
}))
// The masked view of a vDC tenant is covered by lib/connections/iaasView: here it lets the list through.
vi.mock("@/lib/connections/iaasView", () => ({
  iaasMappingsView: (list: unknown[]) => list,
  iaasNodeAllowed: () => true,
}))

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, getConnectionByIdMock, pveFetchMock, guestPerimeterAllowsMock, callerMock, tenantPciMappingsMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  guestPerimeterAllowsMock: vi.fn(),
  callerMock: vi.fn(),
  tenantPciMappingsMock: vi.fn(),
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

vi.mock("@/lib/gpu/vdcGuard", () => ({ tenantPciMappings: (...a: any[]) => tenantPciMappingsMock(...a) }))

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
  callerMock.mockReset().mockResolvedValue({ ok: true, tenantId: "default", infra: { kind: "provider" } })
  tenantPciMappingsMock.mockReset().mockImplementation(async (_c: string, list: any[]) => list.filter((m) => m.id === "nic-x710"))
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

  it("answers 502 without the upstream text or address when the PVE call fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    pveFetchMock.mockRejectedValue(new Error("Connect Timeout Error (attempted address: 173.208.138.139:8006, timeout: 10000ms)"))

    const { status, json } = await get("pci")

    expect(status).toBe(502)
    expect(json).toEqual({ error: "pve_unreachable" })
    expect(JSON.stringify(json)).not.toMatch(/173\.208|8006|Timeout/)
    expect(spy).toHaveBeenCalledWith("[cluster-mapping] read failed:", expect.stringContaining("173.208.138.139"))
    spy.mockRestore()
  })
})

// A vDC tenant gets its GPUs through its vDC GPU section (#672): the hardware
// dialog never offers a mapping that covers a GPU (judged in vdcGuard).
describe("GET .../cluster/mapping/[kind]: GPU mappings of a vDC tenant", () => {
  const mappings = [{ id: "gpu-n1-03-00" }, { id: "nic-x710" }, { id: "vgpu-n1-03-00" }]

  it("hands the PCI list of a vDC tenant to the GPU filter", async () => {
    callerMock.mockResolvedValue({ ok: true, tenantId: "t1", infra: { kind: "iaas", vdcScope: { nodesByConnection: new Map() } } })
    pveFetchMock.mockResolvedValue(mappings)

    const { status, json } = await get("pci")

    expect(status).toBe(200)
    expect(json.data).toEqual([{ id: "nic-x710" }])
    expect(tenantPciMappingsMock).toHaveBeenCalledWith("conn-1", mappings)
  })

  it("keeps the whole list for USB and for the provider", async () => {
    pveFetchMock.mockResolvedValue(mappings)
    expect((await get("pci")).json.data).toEqual(mappings)

    callerMock.mockResolvedValue({ ok: true, tenantId: "t1", infra: { kind: "iaas", vdcScope: { nodesByConnection: new Map() } } })
    expect((await get("usb")).json.data).toEqual(mappings)
    expect(tenantPciMappingsMock).not.toHaveBeenCalled()
  })
})
