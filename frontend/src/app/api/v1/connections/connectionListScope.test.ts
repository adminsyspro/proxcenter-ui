import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../__tests__/setup/route-test"

const { findManyGlobalMock, findManySessionMock, getInfraMock, checkPermissionMock } = vi.hoisted(() => ({
  findManyGlobalMock: vi.fn(),
  findManySessionMock: vi.fn(),
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { findMany: findManySessionMock } }),
  getCurrentTenantId: async () => "tenant-x",
}))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: { findMany: findManyGlobalMock } } }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: () => checkPermissionMock(),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", CONNECTION_MANAGE: "connection.manage" },
}))
vi.mock("@/lib/crypto/secret", () => ({ encryptSecret: (s: string) => `enc:${s}` }))
vi.mock("@/lib/schemas", () => ({ createConnectionSchema: { safeParse: (b: any) => ({ success: true, data: b }) } }))
vi.mock("@/lib/proxmox/pbs-client", () => ({ pbsFetch: vi.fn() }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))
vi.mock("@/lib/orchestrator/client", () => ({ orchestratorFetch: vi.fn() }))
vi.mock("@/lib/proxmox/discoverNodeIps", () => ({ discoverNodeIps: vi.fn() }))
vi.mock("@/lib/proxmox/pbsFingerprint", () => ({ captureFingerprint: vi.fn() }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  findManyGlobalMock.mockReset().mockResolvedValue([])
  findManySessionMock.mockReset().mockResolvedValue([])
  getInfraMock.mockReset()
})

describe("GET /api/v1/connections scope", () => {
  it("provider: queries the GLOBAL client with no id filter", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)
    expect(findManyGlobalMock).toHaveBeenCalled()
    expect(findManySessionMock).not.toHaveBeenCalled()
    expect(findManyGlobalMock.mock.calls[0][0].where?.id).toBeUndefined()
  })

  it("msp: queries the SESSION (tenant-scoped) client, no id filter", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)
    expect(findManySessionMock).toHaveBeenCalled()
    expect(findManyGlobalMock).not.toHaveBeenCalled()
  })

  it("iaas: queries the GLOBAL client filtered by the vDC connection ids", async () => {
    const vdcScope = { connectionIds: new Set(["p1", "p2"]), pbsConnectionIds: new Set(["pbs1"]) }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)
    expect(new Set(findManyGlobalMock.mock.calls[0][0].where.id.in)).toEqual(new Set(["p1", "p2", "pbs1"]))
  })
})
