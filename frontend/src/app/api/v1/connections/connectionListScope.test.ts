import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../__tests__/setup/route-test"

const { findManyGlobalMock, findManySessionMock, getInfraMock, checkPermissionMock, getRBACContextMock, getRbacInfraScopeMock } = vi.hoisted(() => ({
  findManyGlobalMock: vi.fn(),
  findManySessionMock: vi.fn(),
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getRBACContextMock: vi.fn(),
  getRbacInfraScopeMock: vi.fn(),
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
  getRBACContext: () => getRBACContextMock(),
  getRbacInfraScope: (...a: any[]) => getRbacInfraScopeMock(...a),
  filterVisibleConnections: (list: Array<{ id: string }>, scope: any) => {
    if (scope === null) return list
    return list.filter((item: { id: string }) => {
      return scope.fullConnections?.has(item.id) || scope.nodesByConnection?.has(item.id)
    })
  },
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
  // Default: no RBAC context (unauthenticated / unrestricted path)
  getRBACContextMock.mockReset().mockResolvedValue(null)
  getRbacInfraScopeMock.mockReset().mockResolvedValue(null)
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

  it("provider + node/connection-scoped RBAC user: list filtered to the scoped connection only", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    getRBACContextMock.mockResolvedValue({ userId: "user-rbac", isAdmin: false, tenantId: "tenant-x" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(["connA"]),
      nodesByConnection: new Map(),
    })
    const rows = [
      { id: "connA", name: "A", type: "pve", tenantId: null, baseUrl: "", behindProxy: false, insecureTLS: false, hasCeph: false, latitude: null, longitude: null, locationLabel: null, country: null, fingerprint: null, sshEnabled: false, sshPort: 22, sshUser: "root", sshAuthMethod: null, sshUseSudo: false, sshKeyEnc: null, sshPassEnc: null, createdAt: new Date(), updatedAt: new Date(), hosts: [] },
      { id: "connB", name: "B", type: "pve", tenantId: null, baseUrl: "", behindProxy: false, insecureTLS: false, hasCeph: false, latitude: null, longitude: null, locationLabel: null, country: null, fingerprint: null, sshEnabled: false, sshPort: 22, sshUser: "root", sshAuthMethod: null, sshUseSudo: false, sshKeyEnc: null, sshPassEnc: null, createdAt: new Date(), updatedAt: new Date(), hosts: [] },
      { id: "connC", name: "C", type: "pve", tenantId: null, baseUrl: "", behindProxy: false, insecureTLS: false, hasCeph: false, latitude: null, longitude: null, locationLabel: null, country: null, fingerprint: null, sshEnabled: false, sshPort: 22, sshUser: "root", sshAuthMethod: null, sshUseSudo: false, sshKeyEnc: null, sshPassEnc: null, createdAt: new Date(), updatedAt: new Date(), hosts: [] },
    ]
    findManyGlobalMock.mockResolvedValue(rows)
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe("connA")
    // provider where clause must not have an id filter (prisma query is untouched)
    expect(findManyGlobalMock.mock.calls[0][0].where?.id).toBeUndefined()
  })

  it("provider + admin: full list returned, getRbacInfraScope not consulted", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    getRBACContextMock.mockResolvedValue({ userId: "admin-user", isAdmin: true, tenantId: "tenant-x" })
    const rows = [
      { id: "connA", name: "A", type: "pve", tenantId: null, baseUrl: "", behindProxy: false, insecureTLS: false, hasCeph: false, latitude: null, longitude: null, locationLabel: null, country: null, fingerprint: null, sshEnabled: false, sshPort: 22, sshUser: "root", sshAuthMethod: null, sshUseSudo: false, sshKeyEnc: null, sshPassEnc: null, createdAt: new Date(), updatedAt: new Date(), hosts: [] },
      { id: "connB", name: "B", type: "pve", tenantId: null, baseUrl: "", behindProxy: false, insecureTLS: false, hasCeph: false, latitude: null, longitude: null, locationLabel: null, country: null, fingerprint: null, sshEnabled: false, sshPort: 22, sshUser: "root", sshAuthMethod: null, sshUseSudo: false, sshKeyEnc: null, sshPassEnc: null, createdAt: new Date(), updatedAt: new Date(), hosts: [] },
    ]
    findManyGlobalMock.mockResolvedValue(rows)
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(2)
    expect(getRbacInfraScopeMock).not.toHaveBeenCalled()
  })
})
