/**
 * PATCH /users/[id] — external-IdP password guard.
 *
 * An OIDC/LDAP account's password is owned by the identity provider; setting a
 * local password on it would open a credentials login path that bypasses SSO.
 * The route must refuse it (covers both admin-edit and self-service profile).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const getServerSessionMock = vi.fn()
const userFindUniqueMock = vi.fn()
const userUpdateMock = vi.fn()
const isUserProtectedMock = vi.fn()
const isUserSuperAdminMock = vi.fn()
const getCurrentTenantIdMock = vi.fn()
const checkPermissionMock = vi.fn()
const hashPasswordMock = vi.fn(async () => "hashed")

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/password", () => ({ hashPassword: hashPasswordMock }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { findUnique: userFindUniqueMock, update: userUpdateMock } },
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_USERS: "admin.users" },
  isUserSuperAdmin: isUserSuperAdminMock,
  isUserProtected: isUserProtectedMock,
  PROTECTED_ROLE_IDS: ["role_super_admin", "role_provider_admin"],
  PROVIDER_ONLY_ROLE_IDS: ["role_operator", "role_vm_admin", "role_viewer", "role_vm_user"],
}))
vi.mock("@/lib/tenant", () => ({
  DEFAULT_TENANT_ID: "default",
  getCurrentTenantId: getCurrentTenantIdMock,
  addUserToTenant: vi.fn(),
  removeUserFromTenant: vi.fn(),
  TenantMembershipError: class extends Error {},
}))

async function importPATCH() {
  const mod = await import("../route")
  return mod.PATCH
}

describe("PATCH /users/[id] — external-IdP password guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Self-service path: caller edits their own account, only the password field,
    // so no admin permission check is exercised.
    getServerSessionMock.mockResolvedValue({ user: { id: "u1", email: "u1@example.com" } })
    isUserProtectedMock.mockResolvedValue(false)
    getCurrentTenantIdMock.mockResolvedValue("default")
  })

  it.each(["oidc", "ldap"])(
    "rejects a password change on a %s account with 403 and does not write",
    async provider => {
      userFindUniqueMock.mockResolvedValue({ id: "u1", email: "u1@example.com", authProvider: provider })
      const PATCH = await importPATCH()
      const res = await callRoute(PATCH as any, {
        method: "PATCH",
        params: { id: "u1" },
        body: { password: "longenoughpw" },
      })
      expect(res.status).toBe(403)
      const json = await readJson<{ error: string }>(res)
      expect(json?.error).toMatch(/fournisseur d'identité/i)
      expect(userUpdateMock).not.toHaveBeenCalled()
      expect(hashPasswordMock).not.toHaveBeenCalled()
    },
  )
})
