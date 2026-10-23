import { beforeEach, describe, expect, it, vi } from "vitest"

// requireProviderTenant() is judged on the principal, never on
// getCurrentTenantId(): that helper answers `default` for a missing, disabled
// or non-member tenant, which used to promote a customer admin into the
// provider view. The principal and the two membership lookups are mocked.
const { getPrincipalMock, roleFindFirstMock, membershipFindUniqueMock } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn(),
  roleFindFirstMock: vi.fn(),
  membershipFindUniqueMock: vi.fn(),
}))

vi.mock("@/lib/auth/principal", () => ({
  getPrincipal: (...a: any[]) => getPrincipalMock(...a),
  rejectionToResponse: (r: any) => new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 401 }),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    rbacUserRole: { findFirst: (...a: any[]) => roleFindFirstMock(...a) },
    userTenant: { findUnique: (...a: any[]) => membershipFindUniqueMock(...a) },
  },
}))

import { requireProviderTenant } from "./index"

function session(tenantId: string | undefined, userId = "u1") {
  return { ok: true, principal: { kind: "session", userId, tenantId: tenantId ?? "default", connectionIds: null } }
}

beforeEach(() => {
  vi.clearAllMocks()
  roleFindFirstMock.mockResolvedValue(null)
  membershipFindUniqueMock.mockResolvedValue(null)
})

describe("requireProviderTenant", () => {
  it("passes a provider-tenant session whose user is a member of default", async () => {
    getPrincipalMock.mockResolvedValue(session("default"))
    membershipFindUniqueMock.mockResolvedValue({ userId: "u1" })
    expect(await requireProviderTenant()).toBeNull()
    expect(membershipFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_tenantId: { userId: "u1", tenantId: "default" } } }),
    )
  })

  it("passes a super admin on the provider tenant without a membership row", async () => {
    getPrincipalMock.mockResolvedValue(session("default", "sa"))
    roleFindFirstMock.mockResolvedValue({ id: "grant" })
    expect(await requireProviderTenant()).toBeNull()
    expect(membershipFindUniqueMock).not.toHaveBeenCalled()
  })

  it("refuses a customer tenant admin on the raw tenant claim, before any membership lookup", async () => {
    getPrincipalMock.mockResolvedValue(session("tenant-b"))
    const res = await requireProviderTenant()
    expect(res?.status).toBe(403)
    expect(await res!.json()).toEqual({ error: "This operation is only available from the provider tenant" })
    expect(roleFindFirstMock).not.toHaveBeenCalled()
    expect(membershipFindUniqueMock).not.toHaveBeenCalled()
  })

  it("refuses a session claiming default whose user no longer belongs to default (stale JWT)", async () => {
    getPrincipalMock.mockResolvedValue(session("default"))
    expect((await requireProviderTenant())?.status).toBe(403)
  })

  it("answers 401 without a session instead of falling back to the provider tenant", async () => {
    getPrincipalMock.mockResolvedValue({ ok: true })
    expect((await requireProviderTenant())?.status).toBe(401)
  })

  it("relays the rejection of an invalid API token", async () => {
    getPrincipalMock.mockResolvedValue({ ok: false, rejection: { status: 401, body: { error: "Invalid or expired API token" } } })
    expect((await requireProviderTenant())?.status).toBe(401)
  })

  it("judges a token on its own tenant alone: default passes, any other is refused", async () => {
    getPrincipalMock.mockResolvedValue({ ok: true, principal: { kind: "token", tenantId: "default", connectionIds: null } })
    expect(await requireProviderTenant()).toBeNull()
    expect(roleFindFirstMock).not.toHaveBeenCalled()
    expect(membershipFindUniqueMock).not.toHaveBeenCalled()

    getPrincipalMock.mockResolvedValue({ ok: true, principal: { kind: "token", tenantId: "tenant-b", connectionIds: null } })
    expect((await requireProviderTenant())?.status).toBe(403)
  })
})
