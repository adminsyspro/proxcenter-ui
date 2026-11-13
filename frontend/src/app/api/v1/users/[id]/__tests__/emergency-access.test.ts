/**
 * PATCH /users/[id] and the emergency access of an SSO or LDAP account: a
 * local password that keeps working once the identity provider owns the
 * account. Only a super admin grants or withdraws it, and withdrawing it
 * drops the password with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const { sessionMock, userFindUniqueMock, userUpdateMock, isSuperAdminMock, revokeAllSessionsMock, auditMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userUpdateMock: vi.fn(),
  isSuperAdminMock: vi.fn(),
  revokeAllSessionsMock: vi.fn(async (..._args: unknown[]) => 0),
  auditMock: vi.fn(),
}))

// API token guard: pass-through, these tests drive the session path (token
// paths: routeGuard.test.ts, tenancyTokenScope.test.ts).
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_entryId: string, handler: any) => handler }))
vi.mock("@/lib/auth/actingUser", async () => (await import("@/__tests__/fixtures/actingUserFromNextAuth")).actingUserFromNextAuth())
vi.mock("next-auth", () => ({ getServerSession: () => sessionMock() }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/password", () => ({ hashPassword: async () => "hashed" }))
vi.mock("@/lib/auth/sessions", () => ({ revokeAllSessions: (...a: any[]) => revokeAllSessionsMock(...a) }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock, update: userUpdateMock },
    userTenant: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
  },
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: async () => null,
  isUserSuperAdmin: (...a: any[]) => isSuperAdminMock(...a),
  PERMISSIONS: { ADMIN_USERS: "admin.users" },
  PROTECTED_ROLE_IDS: ["role_super_admin", "role_provider_admin"],
}))
vi.mock("@/lib/rbac/assignmentGuards", () => ({ guardRoleAssignment: vi.fn() }))
vi.mock("@/lib/rbac/userTargetGuards", () => ({
  denyIfTargetIsProtectedAndCallerIsNot: async () => null,
  findUserInTenant: vi.fn(),
}))
vi.mock("@/lib/tenant", () => ({
  DEFAULT_TENANT_ID: "default",
  getCurrentTenantId: async () => "default",
  addUserToTenant: vi.fn(),
  removeUserFromTenant: vi.fn(),
  TenantMembershipError: class extends Error {},
}))

import { PATCH } from "../route"

const SSO_USER = {
  id: "u-sso",
  email: "sso@x",
  name: "Sso",
  role: "user",
  authProvider: "oidc",
  localLoginAllowed: false,
  password: null as string | null,
  enabled: true,
  lastLoginAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}
const patch = (body: Record<string, unknown>) =>
  callRoute(PATCH as any, { method: "PATCH", params: { id: "u-sso" }, body })

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { id: "u-sa", email: "sa@x" } })
  isSuperAdminMock.mockResolvedValue(true)
  userFindUniqueMock.mockResolvedValue(SSO_USER)
  userUpdateMock.mockImplementation(async ({ data }: any) => ({ ...SSO_USER, ...data }))
})

describe("PATCH /users/[id] emergency access", () => {
  it("refuses an admin who is not a super admin and writes nothing", async () => {
    isSuperAdminMock.mockResolvedValue(false)

    const res = await patch({ localLoginAllowed: true })
    expect(res.status).toBe(403)
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it("rejects a value that is not a boolean", async () => {
    const res = await patch({ localLoginAllowed: "yes" })
    expect(res.status).toBe(400)
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it("lets a super admin grant it and set the local password in the same save", async () => {
    const res = await patch({ localLoginAllowed: true, password: "Emergency!2026" })
    expect(res.status).toBe(200)
    expect(userUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ localLoginAllowed: true, password: "hashed" }),
    }))
    const body: any = await readJson(res)
    expect(body.data.local_login_allowed).toBe(true)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ localLoginAllowed: true, passwordChanged: true }),
    }))
  })

  it("still refuses a local password on an SSO account without emergency access", async () => {
    const res = await patch({ password: "Sneaky!2026" })
    expect(res.status).toBe(403)
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it("lets the holder of emergency access change their own password", async () => {
    sessionMock.mockResolvedValue({ user: { id: "u-sso", email: "sso@x" } })
    userFindUniqueMock.mockResolvedValue({ ...SSO_USER, localLoginAllowed: true, password: "old" })

    const res = await patch({ password: "Renewed!2026" })
    expect(res.status).toBe(200)
    expect(isSuperAdminMock).not.toHaveBeenCalled()
  })

  it("drops the password and the open sessions when a super admin withdraws it", async () => {
    userFindUniqueMock.mockResolvedValue({ ...SSO_USER, localLoginAllowed: true, password: "old" })

    const res = await patch({ localLoginAllowed: false })
    expect(res.status).toBe(200)
    expect(userUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ localLoginAllowed: false, password: null }),
    }))
    expect(revokeAllSessionsMock).toHaveBeenCalledWith("u-sso")
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ localLoginAllowed: false, passwordRemoved: true }),
    }))
  })

  it("keeps the password of a local account when the flag is withdrawn", async () => {
    userFindUniqueMock.mockResolvedValue({ ...SSO_USER, authProvider: "credentials", localLoginAllowed: true, password: "pw" })

    await patch({ localLoginAllowed: false })
    const { data } = userUpdateMock.mock.calls[0][0]
    expect(data.localLoginAllowed).toBe(false)
    expect(data).not.toHaveProperty("password")
  })

  it("treats the current value sent back as a no-op, even from an admin who is not a super admin", async () => {
    isSuperAdminMock.mockResolvedValue(false)

    const res = await patch({ localLoginAllowed: false })
    expect(res.status).toBe(200)
    expect(userUpdateMock).not.toHaveBeenCalled()
  })
})
