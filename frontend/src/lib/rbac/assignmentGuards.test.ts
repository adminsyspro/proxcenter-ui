import { beforeEach, describe, expect, it, vi } from "vitest"

const { isSuperAdminMock, isProtectedMock, roleFindUniqueMock } = vi.hoisted(() => ({
  isSuperAdminMock: vi.fn(),
  isProtectedMock: vi.fn(),
  roleFindUniqueMock: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({ prisma: { rbacRole: { findUnique: (...a: any[]) => roleFindUniqueMock(...a) } } }))
vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>()
  return {
    ...actual,
    isUserSuperAdmin: (...a: any[]) => isSuperAdminMock(...a),
    isUserProtected: (...a: any[]) => isProtectedMock(...a),
  }
})

import { guardRoleAssignment } from "./assignmentGuards"

const role = (overrides: Record<string, unknown> = {}) => ({
  id: "role_x", name: "X", tenantId: null, permissions: [{ permissionId: "vm.view" }], ...overrides,
})
const input = (overrides: Record<string, unknown> = {}) => ({
  callerUserId: "admin", roleId: "role_x", targetTenantId: "default", targetUserId: "u1", ...overrides,
})
async function body(result: { ok: boolean; response?: Response }) {
  return result.ok ? null : { status: result.response!.status, ...(await result.response!.json()) }
}

beforeEach(() => {
  vi.clearAllMocks()
  isSuperAdminMock.mockResolvedValue(false)
  isProtectedMock.mockResolvedValue(false)
  roleFindUniqueMock.mockResolvedValue(role())
})

describe("guardRoleAssignment", () => {
  it("passes a plain role and hands it back", async () => {
    const result = await guardRoleAssignment(input())
    expect(result).toMatchObject({ ok: true, callerIsSuperAdmin: false, role: { id: "role_x" } })
  })

  it("refuses a provider-only or protected role outside the provider tenant, before any lookup", async () => {
    for (const roleId of ["role_operator", "role_super_admin"]) {
      expect(await body(await guardRoleAssignment(input({ roleId, targetTenantId: "t1" })))).toMatchObject({ status: 400 })
    }
    expect(isSuperAdminMock).not.toHaveBeenCalled()
    expect(roleFindUniqueMock).not.toHaveBeenCalled()
  })

  it("a protected role, or a protected target, reads as unknown to a caller who is not super admin", async () => {
    expect(await body(await guardRoleAssignment(input({ roleId: "role_provider_admin" })))).toMatchObject({ status: 404, error: "Role not found" })
    isProtectedMock.mockResolvedValue(true)
    expect(await body(await guardRoleAssignment(input()))).toMatchObject({ status: 404, error: "User not found" })
  })

  it("skips the protected-target rule when no target is named", async () => {
    isProtectedMock.mockResolvedValue(true)
    expect((await guardRoleAssignment(input({ targetUserId: undefined }))).ok).toBe(true)
    expect(isProtectedMock).not.toHaveBeenCalled()
  })

  it("a super admin grants a protected role to a protected target", async () => {
    isSuperAdminMock.mockResolvedValue(true)
    isProtectedMock.mockResolvedValue(true)
    roleFindUniqueMock.mockResolvedValue(role({ id: "role_provider_admin" }))
    expect(await guardRoleAssignment(input({ roleId: "role_provider_admin" }))).toMatchObject({ ok: true, callerIsSuperAdmin: true })
  })

  it("refuses a role that does not exist, or that belongs to another tenant (roadmap#97)", async () => {
    roleFindUniqueMock.mockResolvedValue(null)
    expect(await body(await guardRoleAssignment(input()))).toMatchObject({ status: 404, error: "Role not found" })
    roleFindUniqueMock.mockResolvedValue(role({ tenantId: "t-other" }))
    expect(await body(await guardRoleAssignment(input({ targetTenantId: "t1" })))).toMatchObject({ status: 404, error: "Role not found" })
    expect((await guardRoleAssignment(input({ targetTenantId: "t-other" }))).ok).toBe(true)
  })

  it("only a super admin grants NIC identity rights (roadmap#97)", async () => {
    roleFindUniqueMock.mockResolvedValue(role({ permissions: [{ permissionId: "vm.config.nic.mac" }] }))
    expect(await body(await guardRoleAssignment(input()))).toMatchObject({ status: 403, error: expect.stringMatching(/NIC identity/) })
    isSuperAdminMock.mockResolvedValue(true)
    expect((await guardRoleAssignment(input())).ok).toBe(true)
  })
})
