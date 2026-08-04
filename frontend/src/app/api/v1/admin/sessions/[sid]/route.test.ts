/**
 * DELETE /api/v1/admin/sessions/[sid] — super-admin revokes a single
 * session anywhere in the installation.
 *
 * revokeSession(sid, userId) (@/lib/auth/sessions) is scoped to an owner, so
 * this route must resolve which user owns the sid before it can call it. A
 * sid that does not exist returns 404, never 403 — matching
 * DELETE /api/v1/auth/sessions/[sid]'s convention that a 403 would confirm
 * the id is real. The audit entry never names the sid.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const {
  getServerSessionMock,
  requireSuperAdminCallerMock,
  sessionFindUniqueMock,
  revokeSessionMock,
  auditMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  requireSuperAdminCallerMock: vi.fn(),
  sessionFindUniqueMock: vi.fn(),
  revokeSessionMock: vi.fn(),
  auditMock: vi.fn(async () => "audit-id"),
}))

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/totp-admin", () => ({
  requireSuperAdminCaller: requireSuperAdminCallerMock,
}))
vi.mock("@/lib/auth/sessions", () => ({ revokeSession: revokeSessionMock }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    session: { findUnique: sessionFindUniqueMock },
  },
}))

async function importDELETE() {
  const mod = await import("./route")
  return mod.DELETE
}

describe("DELETE /api/v1/admin/sessions/[sid]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.com" } })
    requireSuperAdminCallerMock.mockResolvedValue(null)
    sessionFindUniqueMock.mockResolvedValue({ userId: "target-1", user: { email: "target@example.com" } })
    revokeSessionMock.mockResolvedValue(true)
  })

  it("returns the denial requireSuperAdminCaller produces and never resolves or revokes anything", async () => {
    const denial = new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
    requireSuperAdminCallerMock.mockResolvedValue(denial)

    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { sid: "sess-1" } })

    expect(res.status).toBe(403)
    expect(sessionFindUniqueMock).not.toHaveBeenCalled()
    expect(revokeSessionMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it("returns 404, not 403, when the sid does not exist, and reveals nothing about it", async () => {
    sessionFindUniqueMock.mockResolvedValue(null)

    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { sid: "ghost" } })

    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    expect(revokeSessionMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()

    const body = await readJson<any>(res)
    expect(JSON.stringify(body)).not.toMatch(/ghost/)
  })

  it("resolves the owning user first, then calls revokeSession with (sid, ownerUserId)", async () => {
    sessionFindUniqueMock.mockResolvedValue({ userId: "target-1", user: { email: "target@example.com" } })

    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { sid: "sess-1" } })

    expect(res.status).toBe(200)
    expect(sessionFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      select: { userId: true, user: { select: { email: true } } },
    })
    expect(revokeSessionMock).toHaveBeenCalledWith("sess-1", "target-1")
    expect(await readJson<any>(res)).toEqual({ data: { ok: true } })
  })

  it("returns 404 when revokeSession reports nothing was revoked (already gone)", async () => {
    revokeSessionMock.mockResolvedValue(false)

    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE", params: { sid: "sess-1" } })

    expect(res.status).toBe(404)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it("audits the revocation naming the owning user, but never the sid", async () => {
    const DELETE = await importDELETE()
    await callRoute(DELETE as any, { method: "DELETE", params: { sid: "sess-1" } })

    expect(auditMock).toHaveBeenCalledTimes(1)
    const entry = auditMock.mock.calls[0][0]
    expect(entry.action).toBe("session_revoked_single")
    expect(entry.category).toBe("auth")
    expect(entry.resourceType).toBe("user")
    expect(entry.resourceId).toBe("target-1")
    expect(entry.resourceName).toBe("target@example.com")
    expect(entry.userId).toBe("admin-1")
    expect(entry.userEmail).toBe("admin@example.com")

    const serialised = JSON.stringify(entry)
    expect(serialised).not.toMatch(/sess-1/)
  })
})
