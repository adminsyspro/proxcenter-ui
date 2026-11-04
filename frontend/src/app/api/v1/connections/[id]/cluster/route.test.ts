import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

// The cluster summary (every node, every customer's guests) is closed to an
// IaaS tenant (roadmap#189): 404 before any PVE call. For the provider and an
// msp it reads the Ceph health only when the Ceph gate lets the caller through.
const { pveFetchMock, cephGateMock, iaasGateMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  cephGateMock: vi.fn(),
  iaasGateMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn(async () => null),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn(async (id: string) => ({ id, name: "Shared", baseUrl: "https://pve.invalid:8006", apiToken: "t" })),
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock("@/lib/ceph/tenantGuard", () => ({ cephAllowedForCaller: () => cephGateMock() }))
vi.mock("@/lib/tenant/iaasGuard", () => ({ denyIaasTenant: () => iaasGateMock() }))

import { GET } from "./route"

const cephCalls = () => pveFetchMock.mock.calls.filter(([, path]) => String(path).includes("ceph"))

beforeEach(() => {
  vi.clearAllMocks()
  iaasGateMock.mockResolvedValue(null)
  pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path === "/cluster/ceph/status") return { health: { status: "HEALTH_WARN" } }
    if (path === "/nodes") return [{ node: "n1", status: "online" }]
    if (path === "/cluster/status") return [{ type: "cluster", name: "shared" }]
    if (path.endsWith("/status")) return {}
    return []
  })
})

describe("GET /api/v1/connections/[id]/cluster Ceph health", () => {
  it("provider or msp (gate passes): reports the Ceph health", async () => {
    cephGateMock.mockResolvedValue(true)
    const res = await callRoute(GET, { method: "GET", params: { id: "c1" } })
    expect(res.status).toBe(200)
    expect((await res.json()).data.cephHealth).toBe("HEALTH_WARN")
  })

  it("provider or msp with the Ceph gate refusing: cephHealth null, Ceph never read, the rest unchanged", async () => {
    cephGateMock.mockResolvedValue(false)
    const res = await callRoute(GET, { method: "GET", params: { id: "c1" } })
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.cephHealth).toBeNull()
    expect(data.name).toBe("shared")
    expect(cephCalls()).toEqual([])
  })

  it("iaas: 404 Not found, no PVE call at all", async () => {
    const { NextResponse } = await import("next/server")
    iaasGateMock.mockResolvedValue(NextResponse.json({ error: "Not found" }, { status: 404 }))
    const res = await callRoute(GET, { method: "GET", params: { id: "c1" } })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Not found" })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
