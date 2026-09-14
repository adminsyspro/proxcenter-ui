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

const capabilities = [
  { name: "kvm64" },
  { name: "host" },
  { name: "x86-64-v2-AES" },
  { name: "gold", custom: 1 },
  { name: "custom-silver", custom: 1 },
]

function vdcWithPolicy(policy: Record<string, unknown>) {
  return {
    vdcId: "v1",
    poolName: "pool-a",
    quota: null,
    storagePolicies: [],
    computePolicy: {
      cpuModelMode: "unrestricted",
      cpuAllowedModels: [],
      cpuDefaultModel: null,
      cpuAdvancedSettings: true,
      ...policy,
    },
  }
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  // Flat-scoped fallback off by default: the denial path stays the denial path.
  guestPerimeterAllowsMock.mockReset().mockResolvedValue(false)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "c", baseUrl: "https://x:8006", apiToken: "t" })
  pveFetchMock.mockReset()
  getCurrentTenantIdMock.mockReset().mockResolvedValue("default")
  // Provider / no vDC: the list is served untouched and no policy is attached.
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
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
    expect(json.policy).toBeNull()
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

// #893: a tenant whose vDC carries a compute policy gets a narrowed list plus
// the policy itself, so the CPU pickers can follow it without a second call.
describe("GET .../nodes/[node]/cpu-models - vDC compute policy", () => {
  beforeEach(() => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-1")
    pveFetchMock.mockResolvedValue(capabilities)
  })

  it("serves the full list with an unrestricted policy attached", async () => {
    resolveVdcForTenantMock.mockResolvedValue(vdcWithPolicy({}))
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data).toEqual(capabilities)
    expect(json.policy).toEqual({
      cpuModelMode: "unrestricted",
      cpuAdvancedSettings: true,
      cpuDefaultModel: null,
      allowedModels: null,
    })
    expect(resolveVdcForTenantMock).toHaveBeenCalledWith("tenant-1", "conn-1", "pve1")
  })

  it("keeps only the cluster custom models in custom mode", async () => {
    resolveVdcForTenantMock.mockResolvedValue(vdcWithPolicy({ cpuModelMode: "custom", cpuAdvancedSettings: false }))
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.map((m: any) => m.name)).toEqual(["gold", "custom-silver"])
    expect(json.policy.allowedModels).toEqual(["custom-gold", "custom-silver"])
    expect(json.policy.cpuAdvancedSettings).toBe(false)
  })

  it("keeps only the explicitly selected models, custom or built-in", async () => {
    resolveVdcForTenantMock.mockResolvedValue(
      vdcWithPolicy({ cpuModelMode: "selected", cpuAllowedModels: ["x86-64-v2-AES", "custom-gold"], cpuDefaultModel: "x86-64-v2-AES" }),
    )
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.map((m: any) => m.name)).toEqual(["x86-64-v2-AES", "gold"])
    expect(json.policy).toEqual({
      cpuModelMode: "selected",
      cpuAdvancedSettings: true,
      cpuDefaultModel: "x86-64-v2-AES",
      allowedModels: ["custom-gold", "x86-64-v2-AES"],
    })
  })

  it("refuses a node outside the tenant's vDC", async () => {
    resolveVdcForTenantMock.mockRejectedValue(new Error("NODE_NOT_AUTHORIZED"))
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS })
    expect(res.status).toBe(403)
  })
})
