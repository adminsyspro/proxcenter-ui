import { beforeEach, describe, expect, it, vi } from "vitest"

// The Ceph guard is judged on the RAW tenant of the principal, never on
// getCurrentTenantId(), and every failure to resolve the tenant refuses.
const { getPrincipalMock, hasAccessMock, scopeMock, tenantFindUniqueMock } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn(),
  hasAccessMock: vi.fn(),
  scopeMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
}))

vi.mock("@/lib/auth/principal", () => ({
  getPrincipal: (...a: any[]) => getPrincipalMock(...a),
  rejectionToResponse: (r: any) => new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 401 }),
}))
vi.mock("@/lib/tenant", () => ({
  userHasAccessToTenant: (...a: any[]) => hasAccessMock(...a),
  getCurrentTenantId: () => { throw new Error("must not be used by the Ceph guard") },
}))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: (...a: any[]) => scopeMock(...a),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: { tenant: { findUnique: (...a: any[]) => tenantFindUniqueMock(...a) } },
}))

import { denyIaasTenantCeph } from "./tenantGuard"

function session(tenantId: string, userId: string | null = "u1") {
  return { ok: true, principal: { kind: "session", userId: userId ?? undefined, tenantId, connectionIds: null } }
}
function token(tenantId: string) {
  return { ok: true, principal: { kind: "token", tenantId, tokenId: "t1", connectionIds: null } }
}

async function expectNotFound(res: Response | null) {
  expect(res?.status).toBe(404)
  expect(await res!.json()).toEqual({ error: "Not found" })
}

beforeEach(() => {
  vi.clearAllMocks()
  hasAccessMock.mockResolvedValue(true)
  tenantFindUniqueMock.mockResolvedValue({ enabled: true })
})

describe("denyIaasTenantCeph", () => {
  it("lets the provider tenant through", async () => {
    getPrincipalMock.mockResolvedValue(session("default"))
    scopeMock.mockResolvedValue({ kind: "provider" })
    expect(await denyIaasTenantCeph()).toBeNull()
    expect(scopeMock).toHaveBeenCalledWith("default", { ignoreVdcContext: true })
    expect(hasAccessMock).toHaveBeenCalledWith("u1", "default")
  })

  it("lets an MSP tenant through (its own connections)", async () => {
    getPrincipalMock.mockResolvedValue(session("tenant-msp"))
    scopeMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })
    expect(await denyIaasTenantCeph()).toBeNull()
    expect(scopeMock).toHaveBeenCalledWith("tenant-msp", { ignoreVdcContext: true })
  })

  it("answers 404 Not found to an IaaS tenant", async () => {
    getPrincipalMock.mockResolvedValue(session("tenant-iaas"))
    scopeMock.mockResolvedValue({ kind: "iaas", vdcScope: { connectionIds: new Set(["c1"]) } })
    await expectNotFound(await denyIaasTenantCeph())
  })

  it("judges an API token on its own tenant: iaas refused, msp and provider pass", async () => {
    getPrincipalMock.mockResolvedValue(token("tenant-iaas"))
    scopeMock.mockResolvedValue({ kind: "iaas", vdcScope: null })
    await expectNotFound(await denyIaasTenantCeph())
    expect(hasAccessMock).not.toHaveBeenCalled()

    getPrincipalMock.mockResolvedValue(token("tenant-msp"))
    scopeMock.mockResolvedValue({ kind: "msp", connectionIds: new Set() })
    expect(await denyIaasTenantCeph()).toBeNull()

    getPrincipalMock.mockResolvedValue(token("default"))
    scopeMock.mockResolvedValue({ kind: "provider" })
    expect(await denyIaasTenantCeph()).toBeNull()
  })

  it("answers 401 without a principal, as requireProviderTenant does", async () => {
    getPrincipalMock.mockResolvedValue({ ok: true })
    const res = await denyIaasTenantCeph()
    expect(res?.status).toBe(401)
    expect(scopeMock).not.toHaveBeenCalled()
  })

  it("relays the rejection of an invalid API token", async () => {
    getPrincipalMock.mockResolvedValue({ ok: false, rejection: { status: 401, body: { error: "Invalid or expired API token" } } })
    expect((await denyIaasTenantCeph())?.status).toBe(401)
    expect(scopeMock).not.toHaveBeenCalled()
  })

  it("refuses when the principal itself cannot be read", async () => {
    getPrincipalMock.mockRejectedValue(new Error("db down"))
    await expectNotFound(await denyIaasTenantCeph())
  })

  it("refuses when the tenant scope cannot be resolved (fail closed)", async () => {
    getPrincipalMock.mockResolvedValue(session("tenant-msp"))
    scopeMock.mockRejectedValue(new Error("db down at 10.0.0.1"))
    const res = await denyIaasTenantCeph()
    await expectNotFound(res)
  })

  it("refuses a session whose user no longer belongs to its tenant (stale JWT), provider included", async () => {
    hasAccessMock.mockResolvedValue(false)
    getPrincipalMock.mockResolvedValue(session("default"))
    scopeMock.mockResolvedValue({ kind: "provider" })
    await expectNotFound(await denyIaasTenantCeph())

    getPrincipalMock.mockResolvedValue(session("tenant-msp"))
    scopeMock.mockResolvedValue({ kind: "msp", connectionIds: new Set() })
    await expectNotFound(await denyIaasTenantCeph())
  })

  it("refuses a session without a user id", async () => {
    getPrincipalMock.mockResolvedValue(session("default", null))
    scopeMock.mockResolvedValue({ kind: "provider" })
    await expectNotFound(await denyIaasTenantCeph())
  })

  it("refuses a session in a disabled or deleted MSP tenant", async () => {
    getPrincipalMock.mockResolvedValue(session("tenant-msp"))
    scopeMock.mockResolvedValue({ kind: "msp", connectionIds: new Set() })
    tenantFindUniqueMock.mockResolvedValue({ enabled: false })
    await expectNotFound(await denyIaasTenantCeph())
    tenantFindUniqueMock.mockResolvedValue(null)
    await expectNotFound(await denyIaasTenantCeph())
  })

  it("refuses a principal with an empty tenant claim instead of reading it as the provider", async () => {
    getPrincipalMock.mockResolvedValue(token(""))
    scopeMock.mockResolvedValue({ kind: "provider" })
    await expectNotFound(await denyIaasTenantCeph())
    expect(scopeMock).not.toHaveBeenCalled()
  })

  it("refuses an unknown scope kind", async () => {
    getPrincipalMock.mockResolvedValue(session("tenant-x"))
    scopeMock.mockResolvedValue({ kind: "something-else" })
    await expectNotFound(await denyIaasTenantCeph())
  })
})

describe("cephVisibleTo", () => {
  it("is an allow-list: provider and msp only", async () => {
    const { cephVisibleTo } = await import("./tenantVisibility")
    expect(cephVisibleTo({ kind: "provider" })).toBe(true)
    expect(cephVisibleTo({ kind: "msp" })).toBe(true)
    expect(cephVisibleTo({ kind: "iaas" })).toBe(false)
    expect(cephVisibleTo({ kind: "other" } as any)).toBe(false)
    expect(cephVisibleTo(null)).toBe(false)
    expect(cephVisibleTo(undefined)).toBe(false)
  })
})

describe("cephAllowedForCaller", () => {
  it("is true only when the gate lets the caller through", async () => {
    const { cephAllowedForCaller } = await import("./tenantGuard")

    getPrincipalMock.mockResolvedValue(session("default"))
    scopeMock.mockResolvedValue({ kind: "provider" })
    expect(await cephAllowedForCaller()).toBe(true)

    getPrincipalMock.mockResolvedValue(session("tenant-msp"))
    scopeMock.mockResolvedValue({ kind: "msp", connectionIds: new Set() })
    expect(await cephAllowedForCaller()).toBe(true)

    getPrincipalMock.mockResolvedValue(session("tenant-iaas"))
    scopeMock.mockResolvedValue({ kind: "iaas", vdcScope: null })
    expect(await cephAllowedForCaller()).toBe(false)

    getPrincipalMock.mockResolvedValue({ ok: true })
    expect(await cephAllowedForCaller()).toBe(false)

    getPrincipalMock.mockRejectedValue(new Error("db down"))
    expect(await cephAllowedForCaller()).toBe(false)
  })
})
