import { beforeEach, describe, expect, it, vi } from "vitest"

// roadmap#189: the verdict comes from the tenant the principal carries, fails
// closed, and never from getCurrentTenantId().
const h = vi.hoisted(() => ({
  getPrincipal: vi.fn(),
  member: vi.fn(),
  scope: vi.fn(),
  tenant: vi.fn(),
}))

vi.mock("@/lib/auth/principal", () => ({
  getPrincipal: (...a: any[]) => h.getPrincipal(...a),
  rejectionToResponse: (r: any) => new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 401 }),
}))
vi.mock("@/lib/tenant", () => ({
  userHasAccessToTenant: (...a: any[]) => h.member(...a),
  getCurrentTenantId: () => { throw new Error("getCurrentTenantId must not decide the IaaS gate") },
}))
vi.mock("@/lib/tenant/infraScope", () => ({ getTenantInfrastructureScope: (...a: any[]) => h.scope(...a) }))
vi.mock("@/lib/db/prisma", () => ({ prisma: { tenant: { findUnique: (...a: any[]) => h.tenant(...a) } } }))

import { denyIaasTenant, resolveCallerInfraScope } from "./iaasGuard"

const session = (tenantId: string | null) => ({ ok: true, principal: { kind: "session", userId: "u1", tenantId } })

beforeEach(() => {
  vi.clearAllMocks()
  h.member.mockResolvedValue(true)
  h.tenant.mockResolvedValue({ enabled: true })
})

describe("resolveCallerInfraScope", () => {
  it("resolves the principal's tenant, the full vDC union by default", async () => {
    h.getPrincipal.mockResolvedValue(session("t-iaas"))
    h.scope.mockResolvedValue({ kind: "iaas", vdcScope: {} })
    const r = await resolveCallerInfraScope()
    expect(r).toEqual({ ok: true, tenantId: "t-iaas", infra: { kind: "iaas", vdcScope: {} } })
    expect(h.scope).toHaveBeenCalledWith("t-iaas", { ignoreVdcContext: true })
  })

  it("follows the vDC view context when asked", async () => {
    h.getPrincipal.mockResolvedValue(session("t-iaas"))
    h.scope.mockResolvedValue({ kind: "iaas", vdcScope: {} })
    await resolveCallerInfraScope({ ignoreVdcContext: false })
    expect(h.scope).toHaveBeenCalledWith("t-iaas", { ignoreVdcContext: false })
  })

  it("401 without a principal, the rejection as is when the principal is refused", async () => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: null })
    const none = await resolveCallerInfraScope()
    expect(none.ok).toBe(false)
    expect(none.ok === false && none.response.status).toBe(401)

    h.getPrincipal.mockResolvedValue({ ok: false, rejection: { status: 403, body: { error: "Tenant disabled" } } })
    const refused = await resolveCallerInfraScope()
    expect(refused.ok === false && refused.response.status).toBe(403)
  })

  it("a session that no longer belongs to its tenant is refused before any scope lookup", async () => {
    h.getPrincipal.mockResolvedValue(session("t-msp"))
    h.member.mockResolvedValue(false)
    const r = await resolveCallerInfraScope()
    expect(r.ok === false && r.response.status).toBe(404)
    expect(h.scope).not.toHaveBeenCalled()
  })

  it("a token skips the membership and enabled checks (getPrincipal already judged its tenant)", async () => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: { kind: "token", tokenId: "k", tenantId: "t-msp" } })
    h.scope.mockResolvedValue({ kind: "msp", connectionIds: new Set() })
    h.tenant.mockResolvedValue({ enabled: false })
    expect((await resolveCallerInfraScope()).ok).toBe(true)
    expect(h.member).not.toHaveBeenCalled()
    expect(h.tenant).not.toHaveBeenCalled()
  })
})

describe("denyIaasTenant", () => {
  it.each([
    ["provider", { kind: "provider" }, null],
    ["msp", { kind: "msp", connectionIds: new Set() }, null],
    ["iaas", { kind: "iaas", vdcScope: {} }, 404],
  ])("%s", async (_label, infra, status) => {
    h.getPrincipal.mockResolvedValue(session("t"))
    h.scope.mockResolvedValue(infra)
    const res = await denyIaasTenant()
    expect(res?.status ?? null).toBe(status)
  })

  it("a disabled MSP tenant's session and a lookup error are refused (fail closed)", async () => {
    h.getPrincipal.mockResolvedValue(session("t-msp"))
    h.scope.mockResolvedValue({ kind: "msp", connectionIds: new Set() })
    h.tenant.mockResolvedValue({ enabled: false })
    expect((await denyIaasTenant())?.status).toBe(404)

    h.scope.mockRejectedValue(new Error("db down"))
    expect((await denyIaasTenant())?.status).toBe(404)
  })
})
