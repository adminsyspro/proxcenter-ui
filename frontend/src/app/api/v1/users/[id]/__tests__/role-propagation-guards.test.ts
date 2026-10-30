/**
 * PATCH /users/[id] with roleId (roadmap#97): the role lands in every
 * membership tenant, so each of them goes through the shared assignment
 * guard before anything is written, and the first refusal is the answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const { sessionMock, userFindUniqueMock, membershipsMock, guardMock, transactionMock, deleteManyMock, createMock, addUserToTenantMock } = vi.hoisted(() => ({
  addUserToTenantMock: vi.fn(),
  sessionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  membershipsMock: vi.fn(),
  guardMock: vi.fn(),
  transactionMock: vi.fn(),
  deleteManyMock: vi.fn(),
  createMock: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: () => sessionMock() }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/password", () => ({ hashPassword: async () => "hashed" }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock, update: vi.fn() },
    userTenant: { findMany: (...a: any[]) => membershipsMock(...a) },
    rbacUserRole: { findFirst: vi.fn(async () => null), deleteMany: deleteManyMock, create: createMock },
    $transaction: (fn: any) => transactionMock(fn),
  },
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: async () => null,
  PERMISSIONS: { ADMIN_USERS: "admin.users" },
  PROTECTED_ROLE_IDS: ["role_super_admin", "role_provider_admin"],
}))
vi.mock("@/lib/rbac/assignmentGuards", () => ({ guardRoleAssignment: (...a: any[]) => guardMock(...a) }))
vi.mock("@/lib/rbac/userTargetGuards", () => ({ denyIfTargetIsProtectedAndCallerIsNot: async () => null, findUserInTenant: async () => null }))
vi.mock("@/lib/tenant", () => ({
  DEFAULT_TENANT_ID: "default",
  getCurrentTenantId: async () => "default",
  addUserToTenant: (...a: any[]) => addUserToTenantMock(...a),
  removeUserFromTenant: vi.fn(),
  TenantMembershipError: class extends Error {},
}))

import { PATCH } from "../route"

const USER = { id: "u2", email: "u2@x", name: "U2", role: "user", authProvider: "credentials", enabled: true, lastLoginAt: null, createdAt: new Date(0), updatedAt: new Date(0) }
const patch = (body: Record<string, unknown>) => callRoute(PATCH as any, { method: "PATCH", params: { id: "u2" }, body })

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { id: "admin", email: "admin@x" } })
  userFindUniqueMock.mockResolvedValue(USER)
  membershipsMock.mockResolvedValue([{ tenantId: "default" }, { tenantId: "t1" }])
  guardMock.mockResolvedValue({ ok: true, role: { id: "role_x", name: "X", tenantId: null, permissions: [] } })
  transactionMock.mockImplementation(async (fn: any) => fn({ rbacUserRole: { deleteMany: deleteManyMock, create: createMock } }))
})

describe("PATCH /users/[id] roleId goes through the shared assignment guard", () => {
  it("checks the grant in every membership tenant, as the caller acting from the provider tenant, then writes", async () => {
    const res = await patch({ roleId: "role_x" })
    expect(res.status).toBe(200)
    expect(guardMock).toHaveBeenCalledTimes(2)
    expect(guardMock).toHaveBeenCalledWith({ callerUserId: "admin", roleId: "role_x", targetTenantId: "default", targetUserId: "u2" })
    expect(guardMock).toHaveBeenCalledWith({ callerUserId: "admin", roleId: "role_x", targetTenantId: "t1", targetUserId: "u2" })
    expect(createMock).toHaveBeenCalledTimes(2)
  })

  it("the first refusal is the answer, and nothing is written", async () => {
    guardMock
      .mockResolvedValueOnce({ ok: true, role: { id: "role_x" } })
      .mockResolvedValueOnce({ ok: false, response: Response.json({ error: "Role not found" }, { status: 404 }) })
    const res = await patch({ roleId: "role_x" })
    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).error).toBe("Role not found")
    expect(transactionMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it("protected roles stay out of this endpoint even for a passing guard", async () => {
    const res = await patch({ roleId: "role_provider_admin" })
    expect(res.status).toBe(403)
    expect(guardMock).not.toHaveBeenCalled()
  })

  it("clearing the role (null) needs no guard and drops the non-protected grants", async () => {
    const res = await patch({ roleId: null })
    expect(res.status).toBe(200)
    expect(guardMock).not.toHaveBeenCalled()
    expect(deleteManyMock).toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it("checks the tenants of the request, not the current memberships, before writing any of them", async () => {
    guardMock.mockResolvedValueOnce({ ok: false, response: Response.json({ error: "Role not found" }, { status: 404 }) })
    const res = await patch({ roleId: "role_x", tenantIds: ["t2"] })
    expect(res.status).toBe(404)
    expect(guardMock).toHaveBeenCalledWith(expect.objectContaining({ targetTenantId: "t2" }))
    expect(addUserToTenantMock).not.toHaveBeenCalled()
  })

  it("a user without any membership still needs an existing role", async () => {
    membershipsMock.mockResolvedValue([])
    await patch({ roleId: "role_x" })
    expect(guardMock).toHaveBeenCalledWith(expect.objectContaining({ targetTenantId: "default" }))
  })

  it("nobody changes their own roles through this endpoint", async () => {
    sessionMock.mockResolvedValue({ user: { id: "u2", email: "u2@x" } })
    const res = await patch({ roleId: "role_x" })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe("You cannot change your own roles")
    expect(guardMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })
})
