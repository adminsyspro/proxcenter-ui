/**
 * DELETE /api/v1/admin/users/[id]/sessions — admin revokes every session of
 * another user (or their own, targeted explicitly).
 *
 * Guarded by checkPermission(PERMISSIONS.ADMIN_USERS) — the same permission
 * the user-management routes already require — not requireSuperAdminCaller.
 * PATCH /api/v1/users/[id] can already revoke every session of a user (by
 * disabling the account) under that same permission, so gating this
 * standalone action behind super-admin would be strictly more restrictive
 * than an existing route producing the same effect.
 *
 * The admin surface exposes a count and nothing else: the response body must
 * never carry ipAddress or userAgent, and no per-session detail is logged to
 * the audit trail either.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const {
  getServerSessionMock,
  checkPermissionMock,
  revokeAllSessionsMock,
  userFindUniqueMock,
  auditMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  revokeAllSessionsMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  auditMock: vi.fn(async () => "audit-id"),
}))

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_USERS: "admin.users" },
}))
vi.mock("@/lib/auth/sessions", () => ({ revokeAllSessions: revokeAllSessionsMock }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { findUnique: userFindUniqueMock } },
}))

async function importDELETE() {
  const mod = await import("./route")
  return mod.DELETE
}

describe("DELETE /api/v1/admin/users/[id]/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.com" } })
    checkPermissionMock.mockResolvedValue(null)
    userFindUniqueMock.mockResolvedValue({ email: "target@example.com" })
    revokeAllSessionsMock.mockResolvedValue(3)
    auditMock.mockResolvedValue("audit-id")
  })

  it("returns the denial checkPermission produces and never calls revokeAllSessions", async () => {
    const denial = new Response(JSON.stringify({ error: "Permission denied: admin.users" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
    checkPermissionMock.mockResolvedValue(denial)

    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { id: "target-1" } })

    expect(res.status).toBe(403)
    expect(revokeAllSessionsMock).not.toHaveBeenCalled()
    expect(userFindUniqueMock).not.toHaveBeenCalled()
  })

  it("revokes every session of the TARGET user, not the caller — no exception sid", async () => {
    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { id: "target-1" } })

    expect(res.status).toBe(200)
    expect(revokeAllSessionsMock).toHaveBeenCalledTimes(1)
    expect(revokeAllSessionsMock).toHaveBeenCalledWith("target-1")
    // Called with exactly one argument: no exception sid is passed through.
    expect(revokeAllSessionsMock.mock.calls[0]).toEqual(["target-1"])
  })

  it("allows an admin to target their own account", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.com" } })
    userFindUniqueMock.mockResolvedValue({ email: "admin@example.com" })

    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { id: "admin-1" } })

    expect(res.status).toBe(200)
    expect(revokeAllSessionsMock).toHaveBeenCalledWith("admin-1")
  })

  it("returns { data: { revoked } } with no ipAddress or userAgent key anywhere in the body", async () => {
    revokeAllSessionsMock.mockResolvedValue(5)

    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { id: "target-1" } })

    const body = await readJson<any>(res)
    expect(body).toEqual({ data: { revoked: 5 } })

    const serialised = JSON.stringify(body)
    expect(serialised).not.toMatch(/ipAddress/i)
    expect(serialised).not.toMatch(/userAgent/i)
  })

  it("writes an audit entry naming the target but no session-identifying detail", async () => {
    const DELETE = await importDELETE()
    await callRoute(DELETE as any, { method: "DELETE", params: { id: "target-1" } })

    expect(auditMock).toHaveBeenCalledTimes(1)
    const entry = auditMock.mock.calls[0][0]
    expect(entry.category).toBe("auth")
    expect(entry.resourceType).toBe("user")
    expect(entry.resourceId).toBe("target-1")
    expect(entry.resourceName).toBe("target@example.com")
    expect(entry.userId).toBe("admin-1")

    const serialised = JSON.stringify(entry)
    expect(serialised).not.toMatch(/ipAddress/i)
    expect(serialised).not.toMatch(/userAgent/i)
  })

  it("returns 404 and never revokes when the target user does not exist", async () => {
    userFindUniqueMock.mockResolvedValue(null)

    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { id: "ghost" } })

    expect(res.status).toBe(404)
    expect(revokeAllSessionsMock).not.toHaveBeenCalled()
  })
})
