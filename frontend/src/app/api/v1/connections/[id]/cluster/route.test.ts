import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

// The cluster summary reads the Ceph health only for a caller the Ceph gate
// lets through (provider, msp): an IaaS tenant on a shared provider cluster
// gets cephHealth null and /cluster/ceph/status is never called for it.
const { pveFetchMock, cephGateMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  cephGateMock: vi.fn(),
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

import { GET } from "./route"

const cephCalls = () => pveFetchMock.mock.calls.filter(([, path]) => String(path).includes("ceph"))

beforeEach(() => {
  vi.clearAllMocks()
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

  it("iaas (gate refuses): cephHealth null, Ceph never read, the rest of the summary unchanged", async () => {
    cephGateMock.mockResolvedValue(false)
    const res = await callRoute(GET, { method: "GET", params: { id: "c1" } })
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.cephHealth).toBeNull()
    expect(data.name).toBe("shared")
    expect(cephCalls()).toEqual([])
  })
})
