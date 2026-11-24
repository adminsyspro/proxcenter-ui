/**
 * ui#1394: a connection still used (a vDC, a tenant that owns it, Site
 * Recovery, micro-segmentation...) is not deleted: DELETE answers 409 with the
 * links by kind, and GET /usage lists them for the dialog beforehand.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const { sessionFindUniqueMock, globalFindUniqueMock, sessionDeleteMock, checkPermissionMock, usageMock } = vi.hoisted(() => ({
  sessionFindUniqueMock: vi.fn(),
  globalFindUniqueMock: vi.fn(),
  sessionDeleteMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  usageMock: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({
    connection: { findUnique: sessionFindUniqueMock, delete: sessionDeleteMock },
    managedHost: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  }),
  getCurrentTenantId: async () => "default",
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: { findUnique: globalFindUniqueMock } } }))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: vi.fn(async () => ({ kind: "provider" })),
  maskingScope: () => null,
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", CONNECTION_MANAGE: "connection.manage" },
}))
vi.mock("@/lib/crypto/secret", () => ({ encryptSecret: (s: string) => s, decryptSecret: (s: string) => s }))
vi.mock("@/lib/schemas", () => ({ updateConnectionSchema: { safeParse: (b: any) => ({ success: true, data: b }) } }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))
vi.mock("@/lib/proxmox/discoverNodeIps", () => ({ discoverNodeIps: vi.fn() }))
vi.mock("@/lib/orchestrator/client", () => ({ orchestratorFetch: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))
vi.mock("@/lib/connections/getConnection", () => ({ invalidateConnectionCache: vi.fn() }))
vi.mock("@/lib/cache/inventoryCache", () => ({ invalidateInventoryCache: vi.fn() }))
vi.mock("@/lib/firewall/guestCoverage", () => ({ evictGuestCoverage: vi.fn() }))
vi.mock("@/lib/firewall/groupUsage", () => ({ evictGroupUsage: vi.fn() }))
vi.mock("@/lib/tenant/iaasGuard", async (orig) => ({ ...(await orig<Record<string, unknown>>()), denyIaasTenant: async () => null }))
vi.mock("@/lib/connections/connectionUsage", () => ({
  connectionUsage: (...args: unknown[]) => usageMock(...args),
  isBlocked: (u: { blocking: Record<string, string[]> }) => Object.values(u.blocking).some(v => v.length > 0),
}))

import { DELETE as deleteRoute } from "./route"
import { GET as usageRoute } from "./usage/route"

type Route = Parameters<typeof callRoute>[0]
const DELETE = deleteRoute as Route
const USAGE = usageRoute as unknown as Route

const inUse = { blocking: { vdcs: ["MSP-DR (MSP)"], replicationJobs: ["Web"] }, apiTokens: ["ci"] }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  sessionFindUniqueMock.mockResolvedValue({ name: "PVE DR", type: "pve", baseUrl: "https://dr:8006", tenantId: "default" })
  sessionDeleteMock.mockResolvedValue({})
  usageMock.mockResolvedValue({ blocking: {}, apiTokens: [] })
  globalFindUniqueMock.mockResolvedValue(null)
})

describe("DELETE /api/v1/connections/[id] (links)", () => {
  it("refuses with 409 and the links by kind while the connection is used", async () => {
    usageMock.mockResolvedValue(inUse)

    const res = await callRoute(DELETE, { params: { id: "dr" }, method: "DELETE" })

    expect(res.status).toBe(409)
    expect(await readJson<any>(res)).toMatchObject({ code: "CONNECTION_IN_USE", usage: inUse })
    expect(sessionDeleteMock).not.toHaveBeenCalled()
  })

  it("checks the links with the connection owner and the caller's tenant", async () => {
    await callRoute(DELETE, { params: { id: "dr" }, method: "DELETE" })

    expect(usageMock).toHaveBeenCalledWith("dr", expect.objectContaining({ type: "pve", tenantId: "default" }), { callerTenantId: "default" })
  })

  it("tells the provider which tenant owns a connection its session cannot reach, instead of a raw 500", async () => {
    sessionFindUniqueMock.mockResolvedValue(null)
    globalFindUniqueMock.mockResolvedValue({ name: "PVE MSP", type: "pve", baseUrl: "https://msp:8006", tenantId: "msp" })
    usageMock.mockResolvedValue({ blocking: { tenantOwner: ["Tenant1"] }, apiTokens: [] })

    const res = await callRoute(DELETE, { params: { id: "msp-conn" }, method: "DELETE" })

    expect(res.status).toBe(409)
    expect(usageMock).toHaveBeenCalledWith("msp-conn", expect.objectContaining({ tenantId: "msp" }), { callerTenantId: "default" })
    expect(sessionDeleteMock).not.toHaveBeenCalled()
  })

  it("deletes a connection nothing uses, API tokens limited to it only warned about", async () => {
    usageMock.mockResolvedValue({ blocking: {}, apiTokens: ["ci"] })

    const res = await callRoute(DELETE, { params: { id: "dr" }, method: "DELETE" })

    expect(res.status).toBe(200)
    expect(sessionDeleteMock).toHaveBeenCalled()
  })
})

describe("GET /api/v1/connections/[id]/usage", () => {
  it("returns the links of the connection", async () => {
    usageMock.mockResolvedValue(inUse)

    const res = await callRoute(USAGE, { params: { id: "dr" } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual(inUse)
  })

  it("reads the links of a tenant-owned connection for the provider", async () => {
    sessionFindUniqueMock.mockResolvedValue(null)
    globalFindUniqueMock.mockResolvedValue({ type: "pve", tenantId: "msp" })
    usageMock.mockResolvedValue({ blocking: { tenantOwner: ["Tenant1"] }, apiTokens: [] })

    const res = await callRoute(USAGE, { params: { id: "msp-conn" } })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).blocking.tenantOwner).toEqual(["Tenant1"])
  })

  it("answers 404 for a connection the caller cannot see", async () => {
    sessionFindUniqueMock.mockResolvedValue(null)

    expect((await callRoute(USAGE, { params: { id: "other" } })).status).toBe(404)
    expect(usageMock).not.toHaveBeenCalled()
  })

  it("needs connection.manage", async () => {
    checkPermissionMock.mockResolvedValue(new Response(null, { status: 403 }))

    expect((await callRoute(USAGE, { params: { id: "dr" } })).status).toBe(403)
  })
})
