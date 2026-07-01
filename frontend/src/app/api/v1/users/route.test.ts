/**
 * POST /api/v1/users — Community auto super-admin grant (issue #512).
 *
 * Community edition has no RBAC role-management UI, so a user created there
 * would otherwise have zero permissions and see nothing. On Community every
 * new user is granted role_super_admin (mirroring the setup account);
 * Enterprise leaves the grant out and assigns scoped roles via the RBAC
 * picker instead. Detection uses getServerLicense() (fail-closed to
 * Community), the same signal that drives RBAC picker visibility in the UI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute } from "@/__tests__/setup/route-test"

const checkPermissionMock = vi.fn()
const getCurrentTenantIdMock = vi.fn()
const getServerLicenseMock = vi.fn()
const hashPasswordMock = vi.fn(async () => "hashed")
const auditMock = vi.fn(async () => {})

const userFindUniqueMock = vi.fn()
const userCreateMock = vi.fn((args: any) => ({ __op: "user.create", args }))
const userTenantCreateMock = vi.fn((args: any) => ({ __op: "userTenant.create", args }))
const rbacUserRoleCreateMock = vi.fn((args: any) => ({ __op: "rbacUserRole.create", args }))
const tenantFindManyMock = vi.fn()
const transactionMock = vi.fn(async (ops: any[]) => ops)

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "admin" } })) }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/password", () => ({ hashPassword: hashPasswordMock }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock, create: userCreateMock },
    userTenant: { create: userTenantCreateMock },
    rbacUserRole: { create: rbacUserRoleCreateMock },
    tenant: { findMany: tenantFindManyMock },
    $transaction: transactionMock,
  },
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_USERS: "admin.users" },
  isUserSuperAdmin: vi.fn(),
  PROTECTED_ROLE_IDS: ["role_super_admin", "role_provider_admin"],
}))
vi.mock("@/lib/tenant", () => ({
  DEFAULT_TENANT_ID: "default",
  getCurrentTenantId: getCurrentTenantIdMock,
}))
vi.mock("@/lib/auth/requireEnterprise", () => ({ getServerLicense: getServerLicenseMock }))

async function importPOST() {
  const mod = await import("./route")
  return mod.POST
}

describe("POST /api/v1/users — Community auto super-admin (issue #512)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkPermissionMock.mockResolvedValue(null) // permission granted
    getCurrentTenantIdMock.mockResolvedValue("default")
    userFindUniqueMock.mockResolvedValue(null) // email is free
  })

  it("Community: grants role_super_admin to the new user and flags the audit", async () => {
    getServerLicenseMock.mockResolvedValue({
      enterprise: false,
      edition: "community",
      licensed: false,
      features: [],
    })
    const POST = await importPOST()
    const res = await callRoute(POST as any, {
      body: { email: "u@example.com", password: "longenoughpw", name: "U" },
    })

    expect(res.status).toBe(200)
    // Legacy role field mirrors the setup super-admin account.
    expect(userCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "super_admin" }) }),
    )
    // A real RBAC grant is created inside the same transaction.
    expect(rbacUserRoleCreateMock).toHaveBeenCalledTimes(1)
    const grantArg = rbacUserRoleCreateMock.mock.calls[0][0]
    expect(grantArg.data).toMatchObject({
      roleId: "role_super_admin",
      scopeType: "global",
      scopeTarget: null,
      tenantId: "default",
    })
    // The grant is tied to the exact user that was created.
    expect(grantArg.data.userId).toBe(userCreateMock.mock.calls[0][0].data.id)
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ superAdminGranted: true }) }),
    )
  })

  it("Enterprise: does NOT auto-grant; the user role stays 'user'", async () => {
    getServerLicenseMock.mockResolvedValue({
      enterprise: true,
      edition: "enterprise",
      licensed: true,
      features: ["rbac"],
    })
    const POST = await importPOST()
    const res = await callRoute(POST as any, {
      body: { email: "e@example.com", password: "longenoughpw" },
    })

    expect(res.status).toBe(200)
    expect(userCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "user" }) }),
    )
    expect(rbacUserRoleCreateMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ superAdminGranted: false }) }),
    )
  })
})
