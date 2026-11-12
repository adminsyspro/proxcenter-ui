/**
 * PATCH /users/[id] from a customer tenant on a user who also belongs to other
 * tenants. The password, the enabled flag and the name are one account for
 * every tenant the user is in: a tenant admin administers the memberships and
 * grants of its own tenant, while the account itself is changed by the
 * provider or by its holder.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const {
  sessionMock,
  tenantMock,
  findUserInTenantMock,
  userFindUniqueMock,
  userUpdateMock,
  membershipCountMock,
  revokeAllSessionsMock,
  serviceDeskFindFirstMock,
  serviceDeskRoleRowMock,
} = vi.hoisted(() => ({
  serviceDeskFindFirstMock: vi.fn(async (..._args: unknown[]): Promise<{ id: string } | null> => null),
  serviceDeskRoleRowMock: vi.fn(async (..._args: unknown[]): Promise<{ id: string } | null> => null),
  sessionMock: vi.fn(),
  tenantMock: vi.fn(),
  findUserInTenantMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userUpdateMock: vi.fn(),
  membershipCountMock: vi.fn(),
  revokeAllSessionsMock: vi.fn(async (..._args: unknown[]) => 0),
}))

// API token guard: pass-through, these tests drive the session path (token
// paths: routeGuard.test.ts, tenancyTokenScope.test.ts).
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_entryId: string, handler: any) => handler }))
vi.mock("@/lib/auth/actingUser", async () => (await import("@/__tests__/fixtures/actingUserFromNextAuth")).actingUserFromNextAuth())
vi.mock("next-auth", () => ({ getServerSession: () => sessionMock() }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/password", () => ({ hashPassword: async () => "hashed" }))
vi.mock("@/lib/auth/sessions", () => ({ revokeAllSessions: (...a: any[]) => revokeAllSessionsMock(...a) }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock, update: userUpdateMock },
    userTenant: { count: (...a: any[]) => membershipCountMock(...a), findMany: vi.fn(async () => []) },
    rbacServiceDeskAssignment: { findFirst: (...a: any[]) => serviceDeskFindFirstMock(...a) },
    rbacUserRole: { findFirst: (...a: any[]) => serviceDeskRoleRowMock(...a) },
  },
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: async () => null,
  PERMISSIONS: { ADMIN_USERS: "admin.users" },
  PROTECTED_ROLE_IDS: ["role_super_admin", "role_provider_admin"],
}))
vi.mock("@/lib/rbac/assignmentGuards", () => ({ guardRoleAssignment: vi.fn() }))
vi.mock("@/lib/rbac/userTargetGuards", () => ({
  denyIfTargetIsProtectedAndCallerIsNot: async () => null,
  findUserInTenant: (...a: any[]) => findUserInTenantMock(...a),
}))
vi.mock("@/lib/tenant", () => ({
  DEFAULT_TENANT_ID: "default",
  getCurrentTenantId: () => tenantMock(),
  addUserToTenant: vi.fn(),
  removeUserFromTenant: vi.fn(),
  TenantMembershipError: class extends Error {},
}))

import { DELETE, PATCH } from "../route"

const SHARED = {
  id: "u-shared",
  email: "shared@x",
  name: "Shared",
  role: "user",
  authProvider: "credentials",
  enabled: true,
  lastLoginAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}
const patch = (body: Record<string, unknown>, id = "u-shared") =>
  callRoute(PATCH as any, { method: "PATCH", params: { id }, body })

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { id: "u-tadmin", email: "tadmin@x" } })
  tenantMock.mockResolvedValue("tenant-a")
  findUserInTenantMock.mockResolvedValue(SHARED)
  userFindUniqueMock.mockResolvedValue(SHARED)
  userUpdateMock.mockImplementation(async ({ data }: any) => ({ ...SHARED, ...data }))
  membershipCountMock.mockResolvedValue(1)
})

describe("PATCH /users/[id] on a user shared with other tenants", () => {
  it.each([
    ["password", { password: "Hijacked!2026" }],
    ["enabled", { enabled: false }],
    ["name", { name: "renamed by tenant A" }],
  ])("refuses a %s change from a customer tenant and writes nothing", async (_field, body) => {
    const res = await patch(body)
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toMatch(/other tenants/i)
    expect(userUpdateMock).not.toHaveBeenCalled()
    expect(revokeAllSessionsMock).not.toHaveBeenCalled()
    expect(membershipCountMock).toHaveBeenCalledWith({ where: { userId: "u-shared", tenantId: { not: "tenant-a" } } })
  })

  it("writes nothing for account fields sent back with their current values (a role-only edit of the dialog)", async () => {
    const res = await patch({ name: "Shared", enabled: true })
    expect(res.status).toBe(200)
    // Not even a no-op write: a provider who disables the account between
    // this request's read and its write must not see it re-enabled.
    expect(userUpdateMock).not.toHaveBeenCalled()
    expect(revokeAllSessionsMock).not.toHaveBeenCalled()
  })

  it("refuses to re-enable a shared account the provider has just disabled", async () => {
    findUserInTenantMock.mockResolvedValue({ ...SHARED, enabled: false })
    const res = await patch({ name: "Shared", enabled: true })
    expect(res.status).toBe(403)
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it("still lets the tenant admin change a user who belongs to this tenant only", async () => {
    membershipCountMock.mockResolvedValue(0)
    const res = await patch({ password: "Legit!2026", enabled: true })
    expect(res.status).toBe(200)
    expect(userUpdateMock).toHaveBeenCalledOnce()
  })

  it("refuses any change to a provider service desk account from a customer tenant (ui#1336)", async () => {
    membershipCountMock.mockResolvedValue(0)
    serviceDeskFindFirstMock.mockResolvedValue({ id: "sda_1" })
    const res = await patch({ name: "Shared" })
    expect(res.status).toBe(403)
    expect((await readJson<{ code: string }>(res))?.code).toBe("SERVICE_DESK_ACCOUNT")
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it("lets the provider view change the account whatever its memberships", async () => {
    tenantMock.mockResolvedValue("default")
    const res = await patch({ enabled: false })
    expect(res.status).toBe(200)
    expect(userUpdateMock).toHaveBeenCalledOnce()
    expect(membershipCountMock).not.toHaveBeenCalled()
  })

  it("keeps self-service open: the holder changes their own name and password", async () => {
    sessionMock.mockResolvedValue({ user: { id: "u-shared", email: "shared@x" } })
    const res = await patch({ name: "my name", password: "MyOwn!2026" })
    expect(res.status).toBe(200)
    expect(userUpdateMock).toHaveBeenCalledOnce()
    expect(membershipCountMock).not.toHaveBeenCalled()
  })
})

describe("DELETE /users/[id] on a provider service desk account (ui#1336)", () => {
  it("refuses from a customer tenant, before any token or membership is touched", async () => {
    serviceDeskFindFirstMock.mockResolvedValue({ id: "sda_1" })
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { id: "u-shared" } })
    expect(res.status).toBe(403)
    expect((await readJson<{ code: string }>(res))?.code).toBe("SERVICE_DESK_ACCOUNT")
  })

  it("refuses too when the account holds a service desk role through the provider SSO mapping", async () => {
    serviceDeskFindFirstMock.mockResolvedValue(null)
    serviceDeskRoleRowMock.mockResolvedValue({ id: "oidc_1" })
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { id: "u-shared" } })
    expect(res.status).toBe(403)
    expect((await readJson<{ code: string }>(res))?.code).toBe("SERVICE_DESK_ACCOUNT")
    serviceDeskRoleRowMock.mockResolvedValue(null)
  })
})
