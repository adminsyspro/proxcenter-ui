import { beforeEach, describe, expect, it, vi } from "vitest"


// The IaaS tenant gate decides on the principal's own tenant; here it follows
// this file's tenant mocks (lib/tenant/iaasGuard.routes.test.ts covers the gate).
vi.mock("@/lib/tenant/iaasGuard", async () => {
  const { NextResponse } = await import("next/server")
  const resolveCallerInfraScope = async (opts: { ignoreVdcContext?: boolean } = {}) => {
    const { getCurrentTenantId } = await import("@/lib/tenant")
    const { getTenantInfrastructureScope } = await import("@/lib/tenant/infraScope")
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: opts.ignoreVdcContext ?? true })
    return { ok: true as const, tenantId, infra }
  }
  const denyIaasTenant = async () => {
    const caller = await resolveCallerInfraScope()
    return caller.infra?.kind === "iaas" ? NextResponse.json({ error: "Not found" }, { status: 404 }) : null
  }
  return { resolveCallerInfraScope, denyIaasTenant }
})

import { callRoute } from "../../../../__tests__/setup/route-test"

const { findManyGlobalMock, findManySessionMock, getInfraMock, checkPermissionMock, getRBACContextMock, getRbacInfraScopeMock, getGuestVisibleConnectionIdsMock } = vi.hoisted(() => ({
  findManyGlobalMock: vi.fn(),
  findManySessionMock: vi.fn(),
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getRBACContextMock: vi.fn(),
  getRbacInfraScopeMock: vi.fn(),
  getGuestVisibleConnectionIdsMock: vi.fn(),
}))

/** Minimal connection row, only the columns the route selects. */
const connRow = (id: string) => ({
  id, name: id, type: "pve", tenantId: null, baseUrl: "", behindProxy: false, insecureTLS: false,
  hasCeph: false, latitude: null, longitude: null, locationLabel: null, country: null,
  fingerprint: null, sshEnabled: false, sshPort: 22, sshUser: "root", sshAuthMethod: null,
  sshUseSudo: false, sshKeyEnc: null, sshPassEnc: null, createdAt: new Date(), updatedAt: new Date(),
  hosts: [],
})

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
  getGuestVisibleConnectionIds: (...a: any[]) => getGuestVisibleConnectionIdsMock(...a),
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
  getGuestVisibleConnectionIdsMock.mockReset().mockResolvedValue(new Set<string>())
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

  it("iaas: each row is the name and type only, never the address, nodes, SSH or location (roadmap#189)", async () => {
    const vdcScope = { connectionIds: new Set(["p1"]), pbsConnectionIds: new Set<string>() }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })
    findManyGlobalMock.mockResolvedValue([{
      ...connRow("p1"), name: "PVE-PROD", baseUrl: "https://10.0.0.1:8006", subType: null, behindProxy: true, insecureTLS: true,
      hosts: [{ id: "h1", node: "pve1", ip: "10.0.0.1", enabled: true }], sshEnabled: true, sshKeyEnc: "k",
      fingerprint: "AA:BB", latitude: 45.7, longitude: 4.8, locationLabel: "Lyon", country: "FR", replicationNetwork: "10.9.0.0/24",
    }])
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)
    const [row] = (await res.json()).data
    expect(Object.keys(row).sort((a, b) => a.localeCompare(b))).toEqual(["createdAt", "hasCeph", "id", "name", "subType", "type", "updatedAt"])
    expect(row).toMatchObject({ id: "p1", name: "PVE-PROD", type: "pve", hasCeph: false })
  })

  it("provider and msp keep the full rows", async () => {
    for (const infra of [{ kind: "provider" }, { kind: "msp", connectionIds: new Set(["p1"]) }]) {
      getInfraMock.mockResolvedValue(infra)
      const row = { ...connRow("p1"), baseUrl: "https://10.0.0.1:8006", hosts: [{ id: "h1", node: "pve1", ip: "10.0.0.1", enabled: true }] }
      findManyGlobalMock.mockResolvedValue([row])
      findManySessionMock.mockResolvedValue([row])
      const { GET } = await import("./route")
      const [out] = (await (await callRoute(GET, { method: "GET" })).json()).data
      expect(out.baseUrl).toBe("https://10.0.0.1:8006")
      expect(out.hosts).toEqual([{ id: "h1", node: "pve1", ip: "10.0.0.1", enabled: true }])
    }
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

  // Issue #262: the wizards ask for the guest-derived perimeter on top of the
  // strict one, otherwise a pool-scoped user gets no cluster to create on.
  it("guest-derived scope: hidden by default, added back with includeGuestScoped", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    getRBACContextMock.mockResolvedValue({ userId: "user-pool", isAdmin: false, tenantId: "tenant-x" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map(),
      guestDerived: true,
    })
    getGuestVisibleConnectionIdsMock.mockResolvedValue(new Set(["connB"]))
    findManyGlobalMock.mockResolvedValue([connRow("connA"), connRow("connB")])

    const { GET } = await import("./route")

    const strict = await callRoute(GET, { method: "GET" })
    expect((await strict.json()).data).toHaveLength(0)
    expect(getGuestVisibleConnectionIdsMock).not.toHaveBeenCalled()

    const widened = await callRoute(GET, { method: "GET", searchParams: { includeGuestScoped: "1" } })
    const body = await widened.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe("connB")
  })

  it("includeGuestScoped is inert for an infra-scoped user", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    getRBACContextMock.mockResolvedValue({ userId: "user-node", isAdmin: false, tenantId: "tenant-x" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(["connA"]),
      nodesByConnection: new Map(),
      guestDerived: false,
    })
    findManyGlobalMock.mockResolvedValue([connRow("connA"), connRow("connB")])

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { includeGuestScoped: "1" } })
    const body = await res.json()

    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe("connA")
    expect(getGuestVisibleConnectionIdsMock).not.toHaveBeenCalled()
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

describe("GET /api/v1/connections Ceph fields", () => {
  const cephRow = (id: string) => ({ ...connRow(id), hasCeph: true, cephExporterPort: 9926 })
  const iaas = { kind: "iaas", vdcScope: { connectionIds: new Set(["p1"]), pbsConnectionIds: new Set<string>() } }

  it("iaas: a shared provider cluster reads as no Ceph, without its exporter port", async () => {
    getInfraMock.mockResolvedValue(iaas)
    findManyGlobalMock.mockResolvedValue([cephRow("p1")])
    const { GET } = await import("./route")
    const body = await (await callRoute(GET, { method: "GET" })).json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].hasCeph).toBe(false)
    expect(body.data[0]).not.toHaveProperty("cephExporterPort")
  })

  it("iaas: ?hasCeph=true lists nothing, so the Ceph page shows its empty state", async () => {
    getInfraMock.mockResolvedValue(iaas)
    findManyGlobalMock.mockResolvedValue([cephRow("p1")])
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { type: "pve", hasCeph: "true" } })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([])
  })

  it("provider and msp keep hasCeph, the exporter port and the ?hasCeph=true list", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    findManyGlobalMock.mockResolvedValue([cephRow("p1")])
    const { GET } = await import("./route")
    const provider = await (await callRoute(GET, { method: "GET", searchParams: { hasCeph: "true" } })).json()
    expect(provider.data).toEqual([expect.objectContaining({ id: "p1", hasCeph: true, cephExporterPort: 9926 })])

    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["p1"]) })
    findManySessionMock.mockResolvedValue([cephRow("p1")])
    const msp = await (await callRoute(GET, { method: "GET", searchParams: { hasCeph: "true" } })).json()
    expect(msp.data).toEqual([expect.objectContaining({ id: "p1", hasCeph: true, cephExporterPort: 9926 })])
  })
})
