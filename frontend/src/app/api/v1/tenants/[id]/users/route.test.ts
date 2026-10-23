/**
 * POST /api/v1/tenants/[id]/users grants the role named in the body inside the
 * target tenant, so it follows the rules of POST /rbac/assignments: the role
 * must exist, provider-only and protected roles never land in a customer
 * tenant, and protected roles come from a super admin only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const {
  checkPermissionMock,
  isUserSuperAdminMock,
  requireProviderTenantMock,
  addUserToTenantMock,
  roleFindUniqueMock,
  grantFindFirstMock,
  grantCreateMock,
  sessionMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  isUserSuperAdminMock: vi.fn(),
  requireProviderTenantMock: vi.fn(),
  addUserToTenantMock: vi.fn(),
  roleFindUniqueMock: vi.fn(),
  grantFindFirstMock: vi.fn(),
  grantCreateMock: vi.fn(),
  sessionMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  isUserSuperAdmin: (...a: any[]) => isUserSuperAdminMock(...a),
  PERMISSIONS: { ADMIN_TENANTS: "admin.tenants" },
  PROTECTED_ROLE_IDS: ["role_super_admin", "role_provider_admin"],
  PROVIDER_ONLY_ROLE_IDS: ["role_operator", "role_vm_admin", "role_viewer", "role_vm_user"],
}))
vi.mock("@/lib/tenant", () => ({
  DEFAULT_TENANT_ID: "default",
  requireProviderTenant: () => requireProviderTenantMock(),
  addUserToTenant: (...a: any[]) => addUserToTenantMock(...a),
  getTenantUsers: vi.fn(),
  removeUserFromTenant: vi.fn(),
  TenantMembershipError: class extends Error {},
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    rbacRole: { findUnique: (...a: any[]) => roleFindUniqueMock(...a) },
    rbacUserRole: { findFirst: (...a: any[]) => grantFindFirstMock(...a), create: (...a: any[]) => grantCreateMock(...a) },
  },
}))
vi.mock("next-auth", () => ({ getServerSession: () => sessionMock() }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => "audit-id") }))

async function post(tenantId: string, body: Record<string, unknown>) {
  const { POST } = await import("./route")
  return callRoute(POST as any, { method: "POST", params: { id: tenantId }, body })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  // Caller "sa" is the super admin; everyone else, target included, is not.
  isUserSuperAdminMock.mockImplementation(async (id: string) => id === "sa")
  sessionMock.mockResolvedValue({ user: { id: "admin", email: "admin@x" } })
  roleFindUniqueMock.mockImplementation(async ({ where }: any) =>
    ["role_viewer", "role_tenant_viewer", "role_tenant_admin", "role_operator", "role_super_admin", "role_provider_admin"].includes(where.id)
      ? { id: where.id }
      : null,
  )
  grantFindFirstMock.mockResolvedValue(null)
  grantCreateMock.mockResolvedValue({})
  addUserToTenantMock.mockResolvedValue(undefined)
})

describe("POST /api/v1/tenants/[id]/users", () => {
  it("adds the member and grants role_tenant_viewer in a customer tenant when no role is named (TenantsTab payload)", async () => {
    const res = await post("t1", { userId: "u1" })
    expect(res.status).toBe(200)
    expect(roleFindUniqueMock).toHaveBeenCalledWith({ where: { id: "role_tenant_viewer" }, select: { id: true } })
    expect(addUserToTenantMock).toHaveBeenCalledWith("u1", "t1", false)
    expect(grantCreateMock.mock.calls[0][0].data).toMatchObject({ userId: "u1", roleId: "role_tenant_viewer", tenantId: "t1", scopeType: "inherit" })
  })

  it("grants role_viewer in the provider tenant when no role is named", async () => {
    expect((await post("default", { userId: "u1" })).status).toBe(200)
    expect(grantCreateMock.mock.calls[0][0].data).toMatchObject({ roleId: "role_viewer", tenantId: "default" })
  })

  it("grants a tenant role named in the body", async () => {
    expect((await post("t1", { userId: "u1", roleId: "role_tenant_admin" })).status).toBe(200)
    expect(grantCreateMock.mock.calls[0][0].data.roleId).toBe("role_tenant_admin")
  })

  it("refuses a provider-only or protected role outside the provider tenant, before any write", async () => {
    for (const roleId of ["role_operator", "role_super_admin"]) {
      const res = await post("t1", { userId: "u1", roleId })
      expect(res.status).toBe(400)
      expect((await readJson<any>(res)).error).toBe("This role can only be assigned in the provider tenant (default)")
    }
    expect(addUserToTenantMock).not.toHaveBeenCalled()
    expect(grantCreateMock).not.toHaveBeenCalled()
  })

  it("hides a protected role from a caller who is not super admin, even in the provider tenant", async () => {
    const res = await post("default", { userId: "u1", roleId: "role_provider_admin" })
    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).error).toBe("Role not found")
    expect(addUserToTenantMock).not.toHaveBeenCalled()
  })

  it("lets a super admin grant a protected role in the provider tenant", async () => {
    sessionMock.mockResolvedValue({ user: { id: "sa", email: "sa@x" } })
    expect((await post("default", { userId: "u1", roleId: "role_provider_admin" })).status).toBe(200)
    expect(grantCreateMock.mock.calls[0][0].data).toMatchObject({ roleId: "role_provider_admin", tenantId: "default" })
  })

  it("refuses a role that does not exist", async () => {
    const res = await post("t1", { userId: "u1", roleId: "role_ghost" })
    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).error).toBe("Role not found")
    expect(addUserToTenantMock).not.toHaveBeenCalled()
  })

  it("stays behind the provider tenant gate", async () => {
    requireProviderTenantMock.mockResolvedValue(new Response("forbidden", { status: 403 }))
    expect((await post("t1", { userId: "u1" })).status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(addUserToTenantMock).not.toHaveBeenCalled()
  })
})
