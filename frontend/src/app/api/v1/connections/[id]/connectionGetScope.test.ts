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

import { callRoute } from "../../../../../__tests__/setup/route-test"

// Hoist mocks so they are available in vi.mock factories
const { findUniqueGlobalMock, getInfraMock, checkPermissionMock } = vi.hoisted(() => ({
  findUniqueGlobalMock: vi.fn(),
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

// Keep REAL maskingScope; only mock getTenantInfrastructureScope
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

// Tenant helpers -- tenantId is controlled per test via getInfraMock
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({
    connection: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    managedHost: { deleteMany: vi.fn() },
  }),
  getCurrentTenantId: async () => currentTenantId,
}))

// Global prisma -- only findUnique is exercised by GET
vi.mock("@/lib/db/prisma", () => ({
  prisma: { connection: { findUnique: findUniqueGlobalMock } },
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: () => checkPermissionMock(),
  PERMISSIONS: {
    CONNECTION_VIEW: "connection.view",
    CONNECTION_MANAGE: "connection.manage",
  },
}))

vi.mock("@/lib/crypto/secret", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s,
}))
vi.mock("@/lib/schemas", () => ({
  updateConnectionSchema: { safeParse: (b: any) => ({ success: true, data: b }) },
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))
vi.mock("@/lib/proxmox/discoverNodeIps", () => ({ discoverNodeIps: vi.fn() }))
vi.mock("@/lib/orchestrator/client", () => ({
  orchestratorFetch: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))
vi.mock("@/lib/connections/getConnection", () => ({ invalidateConnectionCache: vi.fn() }))
vi.mock("@/lib/cache/inventoryCache", () => ({ invalidateInventoryCache: vi.fn() }))

// Mutable variable: getCurrentTenantId returns this
let currentTenantId = "default"

// The connection stored in the DB is owned by msp-1
const MSP_OWNED_CONNECTION = {
  id: "conn-msp-1",
  tenantId: "msp-1",
  name: "MSP Connection",
  type: "pve",
  baseUrl: "https://10.0.0.1:8006",
  sshKeyEnc: null,
  sshPassEnc: null,
  apiTokenEnc: null,
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  findUniqueGlobalMock.mockReset().mockResolvedValue(MSP_OWNED_CONNECTION)
  getInfraMock.mockReset()
  currentTenantId = "default"
})

describe("GET /api/v1/connections/[id] ownership gate", () => {
  it("provider (kind=provider, tenantId=default) can read an MSP-owned connection -- returns 200", async () => {
    currentTenantId = "default"
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { method: "GET", params: { id: "conn-msp-1" } })

    expect(res.status).toBe(200)
  })

  it("msp tenant that owns the connection (tenantId=msp-1) -- returns 200", async () => {
    currentTenantId = "msp-1"
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-msp-1"]) })

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { method: "GET", params: { id: "conn-msp-1" } })

    expect(res.status).toBe(200)
  })

  it("different msp tenant (tenantId=msp-2) cannot read a connection owned by msp-1 -- returns 404", async () => {
    currentTenantId = "msp-2"
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-other"]) })

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { method: "GET", params: { id: "conn-msp-1" } })

    expect(res.status).toBe(404)
  })

  it("iaas tenant with the connection id in vdcScope.connectionIds -- returns 200", async () => {
    currentTenantId = "iaas-tenant"
    const vdcScope = {
      connectionIds: new Set(["conn-msp-1"]),
      pbsConnectionIds: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map<string, Set<string>>(),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { method: "GET", params: { id: "conn-msp-1" } })

    expect(res.status).toBe(200)
    // roadmap#189: the name and type, never the API address or SSH settings.
    expect((await res.json()).data).toEqual({ id: "conn-msp-1", name: "MSP Connection", type: "pve", hasCeph: false })
  })

  it("iaas tenant with the connection id only in vdcScope.pbsConnectionIds -- returns 200", async () => {
    currentTenantId = "iaas-tenant"
    const vdcScope = {
      connectionIds: new Set<string>(),
      pbsConnectionIds: new Set(["conn-msp-1"]),
      nodesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map<string, Set<string>>(),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { method: "GET", params: { id: "conn-msp-1" } })

    expect(res.status).toBe(200)
  })
})

describe("GET /api/v1/connections/[id] Ceph fields", () => {
  const CEPH_CONNECTION = { ...MSP_OWNED_CONNECTION, tenantId: "default", hasCeph: true, cephExporterPort: 9926 }
  const iaasScope = {
    connectionIds: new Set(["conn-msp-1"]),
    pbsConnectionIds: new Set<string>(),
    nodesByConnection: new Map<string, Set<string>>(),
    poolsByConnection: new Map<string, Set<string>>(),
  }

  async function read() {
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { method: "GET", params: { id: "conn-msp-1" } })
    expect(res.status).toBe(200)
    return (await res.json()).data
  }

  it("iaas: a shared provider cluster reads as no Ceph, without its exporter port", async () => {
    currentTenantId = "iaas-tenant"
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope: iaasScope })
    findUniqueGlobalMock.mockResolvedValue(CEPH_CONNECTION)

    const data = await read()

    expect(data.hasCeph).toBe(false)
    expect(data).not.toHaveProperty("cephExporterPort")
  })

  it("provider and msp keep hasCeph and the exporter port", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    findUniqueGlobalMock.mockResolvedValue(CEPH_CONNECTION)
    expect(await read()).toMatchObject({ hasCeph: true, cephExporterPort: 9926 })

    currentTenantId = "msp-1"
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-msp-1"]) })
    findUniqueGlobalMock.mockResolvedValue({ ...CEPH_CONNECTION, tenantId: "msp-1" })
    expect(await read()).toMatchObject({ hasCeph: true, cephExporterPort: 9926 })
  })
})
