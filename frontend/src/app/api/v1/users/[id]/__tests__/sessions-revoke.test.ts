/**
 * PATCH /users/[id] — revoke open sessions on password change / disable.
 *
 * A password change is what a user does when they believe they are
 * compromised; a disable is an admin doing the same on their behalf. Both
 * are credential-state changes that must cut sessions already open,
 * otherwise a stolen cookie survives the exact defensive act taken against
 * it. This is deliberately hooked after the write lands and before the
 * audit call, and a failure inside it must never turn an already-applied
 * password change into a 500.
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
const auditMock = vi.fn(async () => "audit-id")
const revokeAllSessionsMock = vi.fn(async () => 0)

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/password", () => ({ hashPassword: hashPasswordMock }))
vi.mock("@/lib/auth/sessions", () => ({ revokeAllSessions: revokeAllSessionsMock }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
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

function updatedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "u1@example.com",
    name: "U1",
    role: null,
    authProvider: "credentials",
    enabled: true,
    lastLoginAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  }
}

describe("PATCH /users/[id] — session revocation on credential change", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    revokeAllSessionsMock.mockResolvedValue(0)
    hashPasswordMock.mockResolvedValue("hashed")
    auditMock.mockResolvedValue("audit-id")
    isUserProtectedMock.mockResolvedValue(false)
    getCurrentTenantIdMock.mockResolvedValue("default")
    checkPermissionMock.mockResolvedValue(null)
  })

  it("revokes every session (no exception sid) when the PATCH contains a password", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1", email: "u1@example.com" } })
    userFindUniqueMock.mockResolvedValue({ id: "u1", email: "u1@example.com", authProvider: "credentials" })
    userUpdateMock.mockResolvedValue(updatedRow())

    const PATCH = await importPATCH()
    const res = await callRoute(PATCH as any, {
      method: "PATCH",
      params: { id: "u1" },
      body: { password: "longenoughpw" },
    })

    expect(res.status).toBe(200)
    expect(revokeAllSessionsMock).toHaveBeenCalledTimes(1)
    expect(revokeAllSessionsMock).toHaveBeenCalledWith("u1")
  })

  it("does not revoke sessions when the PATCH only changes name", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1", email: "u1@example.com" } })
    userFindUniqueMock.mockResolvedValue({ id: "u1", email: "u1@example.com", authProvider: "credentials" })
    userUpdateMock.mockResolvedValue(updatedRow({ name: "New Name" }))

    const PATCH = await importPATCH()
    const res = await callRoute(PATCH as any, {
      method: "PATCH",
      params: { id: "u1" },
      body: { name: "New Name" },
    })

    expect(res.status).toBe(200)
    expect(revokeAllSessionsMock).not.toHaveBeenCalled()
  })

  it("revokes sessions when the PATCH disables the account", async () => {
    // Admin (u-admin) disabling another user (u2) — not self, so the
    // self-lockout guard doesn't intercept before the revocation runs.
    getServerSessionMock.mockResolvedValue({ user: { id: "u-admin", email: "admin@example.com" } })
    userFindUniqueMock.mockResolvedValue({ id: "u2", email: "u2@example.com", authProvider: "credentials" })
    userUpdateMock.mockResolvedValue(updatedRow({ id: "u2", email: "u2@example.com", enabled: false }))

    const PATCH = await importPATCH()
    const res = await callRoute(PATCH as any, {
      method: "PATCH",
      params: { id: "u2" },
      body: { enabled: false },
    })

    expect(res.status).toBe(200)
    expect(revokeAllSessionsMock).toHaveBeenCalledTimes(1)
    expect(revokeAllSessionsMock).toHaveBeenCalledWith("u2")
  })

  it("does not revoke sessions when the PATCH re-enables the account", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u-admin", email: "admin@example.com" } })
    userFindUniqueMock.mockResolvedValue({ id: "u2", email: "u2@example.com", authProvider: "credentials" })
    userUpdateMock.mockResolvedValue(updatedRow({ id: "u2", email: "u2@example.com", enabled: true }))

    const PATCH = await importPATCH()
    const res = await callRoute(PATCH as any, {
      method: "PATCH",
      params: { id: "u2" },
      body: { enabled: true },
    })

    expect(res.status).toBe(200)
    expect(revokeAllSessionsMock).not.toHaveBeenCalled()
  })

  it("still returns success and keeps the password change when revokeAllSessions rejects", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1", email: "u1@example.com" } })
    userFindUniqueMock.mockResolvedValue({ id: "u1", email: "u1@example.com", authProvider: "credentials" })
    userUpdateMock.mockResolvedValue(updatedRow())
    revokeAllSessionsMock.mockRejectedValueOnce(new Error("db unreachable"))

    const PATCH = await importPATCH()
    const res = await callRoute(PATCH as any, {
      method: "PATCH",
      params: { id: "u1" },
      body: { password: "longenoughpw" },
    })

    expect(res.status).toBe(200)
    const json = await readJson<{ success: boolean }>(res)
    expect(json?.success).toBe(true)
    expect(userUpdateMock).toHaveBeenCalledTimes(1)
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({ password: "hashed" }),
    })
  })

  it("never reaches revokeAllSessions when the external-IdP guard refuses the password change", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1", email: "u1@example.com" } })
    userFindUniqueMock.mockResolvedValue({ id: "u1", email: "u1@example.com", authProvider: "oidc" })

    const PATCH = await importPATCH()
    const res = await callRoute(PATCH as any, {
      method: "PATCH",
      params: { id: "u1" },
      body: { password: "longenoughpw" },
    })

    expect(res.status).toBe(403)
    expect(userUpdateMock).not.toHaveBeenCalled()
    expect(revokeAllSessionsMock).not.toHaveBeenCalled()
  })
})
