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
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const checkPermissionMock = vi.fn()
const getCurrentTenantIdMock = vi.fn()
const getServerLicenseMock = vi.fn()
const hashPasswordMock = vi.fn(async () => "hashed")
const auditMock = vi.fn(async () => {})
const isUserSuperAdminMock = vi.fn()

const userFindUniqueMock = vi.fn()
const userCreateMock = vi.fn((args: any) => ({ __op: "user.create", args }))
const userFindManyMock = vi.fn()
const userTenantCreateMock = vi.fn((args: any) => ({ __op: "userTenant.create", args }))
const userTenantFindManyMock = vi.fn()
const rbacUserRoleCreateMock = vi.fn((args: any) => ({ __op: "rbacUserRole.create", args }))
const rbacUserRoleFindManyMock = vi.fn()
const tenantFindManyMock = vi.fn()
const transactionMock = vi.fn(async (ops: any[]) => ops)
const sessionGroupByMock = vi.fn()
const sessionCountMock = vi.fn()

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "admin" } })) }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/password", () => ({ hashPassword: hashPasswordMock }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock, create: userCreateMock, findMany: userFindManyMock },
    userTenant: { create: userTenantCreateMock, findMany: userTenantFindManyMock },
    rbacUserRole: { create: rbacUserRoleCreateMock, findMany: rbacUserRoleFindManyMock },
    tenant: { findMany: tenantFindManyMock },
    session: { groupBy: sessionGroupByMock, count: sessionCountMock },
    $transaction: transactionMock,
  },
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_USERS: "admin.users" },
  isUserSuperAdmin: isUserSuperAdminMock,
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

/** Create a user through the route with a valid default payload. */
async function createUser(body: Record<string, unknown> = {}) {
  const POST = await importPOST()
  return callRoute(POST as any, {
    body: { email: "u@example.com", password: "longenoughpw", ...body },
  })
}

async function importGET() {
  const mod = await import("./route")
  return mod.GET
}

function userRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    role: "user",
    authProvider: "credentials",
    enabled: true,
    totpEnabled: false,
    require2faEnrollment: false,
    lastLoginAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  }
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
      resolved: true,
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
      resolved: true,
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

/**
 * The auto-grant may only fire on a POSITIVELY established Community verdict.
 * getServerLicense() fails closed to a Community-looking payload whenever the
 * orchestrator is unreachable or answers non-2xx, and an expired Enterprise
 * licence also reports enterprise:false — granting global super-admin on
 * either would be a privilege escalation (issue #633 follow-up).
 */
describe("POST /api/v1/users, the grant needs a resolved licence (issue #633)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkPermissionMock.mockResolvedValue(null)
    getCurrentTenantIdMock.mockResolvedValue("default")
    userFindUniqueMock.mockResolvedValue(null)
  })

  it("does not grant super-admin when the license verdict is unresolved", async () => {
    getServerLicenseMock.mockResolvedValue({
      enterprise: false, edition: "community", licensed: false, expired: false,
      features: [], options: [], resolved: false,
    })
    const res = await createUser()

    expect(res.status).toBe(200)
    expect(rbacUserRoleCreateMock).not.toHaveBeenCalled()
    expect(userCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "user" }) }),
    )
  })

  it("does not grant super-admin when an enterprise license has expired", async () => {
    getServerLicenseMock.mockResolvedValue({
      enterprise: false, edition: "enterprise", licensed: true, expired: true,
      features: [], options: [], resolved: true,
    })
    const res = await createUser()

    expect(res.status).toBe(200)
    expect(rbacUserRoleCreateMock).not.toHaveBeenCalled()
  })

  it("files the Community grant on the tenant the user was created in", async () => {
    getServerLicenseMock.mockResolvedValue({
      enterprise: false, edition: "community", licensed: false, expired: false,
      features: [], options: [], resolved: true,
    })
    tenantFindManyMock.mockResolvedValue([{ id: "tenant-b" }])
    const res = await createUser({ tenantIds: ["tenant-b"] })

    expect(res.status).toBe(200)
    expect(rbacUserRoleCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: "tenant-b" }) }),
    )
  })
})

/**
 * GET /api/v1/users — active_session_count (Task 12).
 *
 * One grouped query for the whole page, not one count() per user: a per-row
 * count() is an N+1 on a list route. isUserSuperAdmin is stubbed to resolve
 * true so the caller skips the protected-role filtering branch entirely,
 * keeping these tests focused on the session-count wiring.
 */
describe("GET /api/v1/users — active_session_count", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkPermissionMock.mockResolvedValue(null)
    getCurrentTenantIdMock.mockResolvedValue("default")
    isUserSuperAdminMock.mockResolvedValue(true)
    userTenantFindManyMock.mockResolvedValue([])
    rbacUserRoleFindManyMock.mockResolvedValue([])
    sessionGroupByMock.mockResolvedValue([])
    sessionCountMock.mockResolvedValue(0)
  })

  it("attaches active_session_count from a single groupBy call, defaulting absent users to 0", async () => {
    userFindManyMock.mockResolvedValue([userRow("u1"), userRow("u2"), userRow("u3")])
    sessionGroupByMock.mockResolvedValue([
      { userId: "u1", _count: 2 },
      { userId: "u2", _count: 0 },
    ])

    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    const byId = Object.fromEntries(body.data.map((u: any) => [u.id, u.active_session_count]))
    expect(byId.u1).toBe(2)
    expect(byId.u2).toBe(0)
    // Absent from the grouped result => 0, not undefined and not a missing key.
    expect(byId.u3).toBe(0)
    expect("active_session_count" in body.data.find((u: any) => u.id === "u3")).toBe(true)

    // Exactly one grouped query for the whole page — never a per-user count().
    expect(sessionGroupByMock).toHaveBeenCalledTimes(1)
    expect(sessionCountMock).not.toHaveBeenCalled()
  })

  it("scopes the groupBy to the visible page's users and to alive sessions only", async () => {
    userFindManyMock.mockResolvedValue([userRow("u1")])
    sessionGroupByMock.mockResolvedValue([{ userId: "u1", _count: 1 }])

    const GET = await importGET()
    await callRoute(GET as any, { method: "GET" })

    expect(sessionGroupByMock).toHaveBeenCalledTimes(1)
    const arg = sessionGroupByMock.mock.calls[0][0]
    expect(arg.by).toEqual(["userId"])
    expect(arg.where.userId).toEqual({ in: ["u1"] })
    // aliveWhere() liveness fragment: not revoked, within idle + absolute cap.
    expect(arg.where.revokedAt).toBeNull()
    expect(arg.where.lastSeenAt).toBeDefined()
    expect(arg.where.createdAt).toBeDefined()
  })

  it("does not call groupBy at all when the page has no visible users", async () => {
    userFindManyMock.mockResolvedValue([])

    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    expect(body.data).toEqual([])
    expect(sessionGroupByMock).not.toHaveBeenCalled()
  })
})
