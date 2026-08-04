/**
 * GET /api/v1/admin/sessions — super-admin view of every live session in
 * the installation, across every tenant.
 *
 * Gated by requireSuperAdminCaller() — NOT checkPermission(ADMIN_USERS). This
 * is broader visibility than the existing per-user revoke
 * (admin/users/[id]/sessions), which the author deliberately kept behind
 * admin.users; this route is a reversal of a privacy boundary and gets the
 * stricter gate on purpose.
 *
 * Liveness comes from aliveWhere() — the same boundary-tested predicate the
 * self-service and per-user routes use. This file does not re-derive the
 * liveness rule, it only checks the predicate reaches the query.
 *
 * The query is bounded (MAX_SESSION_ROWS in ./route.ts): an MSP installation
 * mid-incident can have far more live sessions than a DataGrid should try to
 * render in one response. Overflow must never be silent — the response says
 * `truncated: true` rather than quietly dropping rows.
 *
 * The caller's own session is marked `current: true` via the same
 * getToken()+sessionCookieName() pattern as /api/v1/auth/sessions/route.ts,
 * so the UI can warn before a revoke click signs the admin out of the
 * screen they are on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const {
  requireSuperAdminCallerMock,
  getTokenMock,
  sessionFindManyMock,
  sessionUpdateManyMock,
  tenantFindManyMock,
  auditMock,
  getServerSessionMock,
} = vi.hoisted(() => ({
  requireSuperAdminCallerMock: vi.fn(),
  getTokenMock: vi.fn(),
  sessionFindManyMock: vi.fn(),
  sessionUpdateManyMock: vi.fn(),
  tenantFindManyMock: vi.fn(),
  auditMock: vi.fn(),
  getServerSessionMock: vi.fn(),
}))

vi.mock("@/lib/auth/totp-admin", () => ({
  requireSuperAdminCaller: requireSuperAdminCallerMock,
}))
vi.mock("next-auth/jwt", () => ({ getToken: getTokenMock }))
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/cookies", () => ({ sessionCookieName: () => "next-auth.session-token" }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    session: { findMany: sessionFindManyMock, updateMany: sessionUpdateManyMock },
    tenant: { findMany: tenantFindManyMock },
  },
}))
// aliveWhere (@/lib/auth/sessions) and deviceLabel (@/lib/auth/deviceLabel)
// are small pure helpers with their own boundary tests — exercised for real
// here rather than mocked.

function row(overrides: Partial<{
  id: string
  userId: string
  ipAddress: string | null
  userAgent: string | null
  user: { email: string; tenantId: string }
}> = {}) {
  return {
    id: "sess-1",
    userId: "u1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-01-02T00:00:00.000Z"),
    ipAddress: "10.0.0.1",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36",
    user: { email: "u1@example.com", tenantId: "tenant-a" },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireSuperAdminCallerMock.mockResolvedValue(null)
  getTokenMock.mockResolvedValue({}) // no sid: no row marked current unless overridden
  sessionFindManyMock.mockResolvedValue([])
  sessionUpdateManyMock.mockResolvedValue({ count: 0 })
  tenantFindManyMock.mockResolvedValue([])
  auditMock.mockResolvedValue(undefined)
  getServerSessionMock.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.com" } })
})

describe("GET /api/v1/admin/sessions", () => {
  async function importGET() {
    const mod = await import("./route")
    return mod.GET
  }

  it("returns the denial requireSuperAdminCaller produces and never queries sessions", async () => {
    const denial = new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
    requireSuperAdminCallerMock.mockResolvedValue(denial)

    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })

    expect(res.status).toBe(403)
    expect(sessionFindManyMock).not.toHaveBeenCalled()
    expect(tenantFindManyMock).not.toHaveBeenCalled()
  })

  it("returns rows across tenants, with ISO date strings and split device parts", async () => {
    sessionFindManyMock.mockResolvedValue([
      row({ id: "sess-1", user: { email: "u1@example.com", tenantId: "tenant-a" } }),
      row({
        id: "sess-2",
        userId: "u2",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/119.0",
        ipAddress: "::1",
        user: { email: "u2@example.com", tenantId: "tenant-b" },
      }),
    ])
    tenantFindManyMock.mockResolvedValue([
      { id: "tenant-a", name: "Tenant A" },
      { id: "tenant-b", name: "Tenant B" },
    ])

    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    expect(body.data).toHaveLength(2)

    const [first, second] = body.data
    expect(first.userEmail).toBe("u1@example.com")
    expect(first.tenantName).toBe("Tenant A")
    expect(second.tenantName).toBe("Tenant B")
    expect(second.browser).toBe("Firefox")
    expect(second.os).toBe("Linux")
    expect(second.ipAddress).toBe("::1")

    for (const s of body.data) {
      expect(typeof s.createdAt).toBe("string")
      expect(new Date(s.createdAt).toISOString()).toBe(s.createdAt)
      expect(typeof s.lastSeenAt).toBe("string")
      expect(new Date(s.lastSeenAt).toISOString()).toBe(s.lastSeenAt)
    }
  })

  it("filters with aliveWhere()'s predicate and orders by lastSeenAt desc", async () => {
    const GET = await importGET()
    await callRoute(GET as any, { method: "GET" })

    expect(sessionFindManyMock).toHaveBeenCalledTimes(1)
    const args = sessionFindManyMock.mock.calls[0][0]
    expect(args.where).toMatchObject({ revokedAt: null })
    expect(args.where.lastSeenAt).toBeDefined()
    expect(args.where.createdAt).toBeDefined()
    expect(args.orderBy).toEqual({ lastSeenAt: "desc" })
  })

  it("the response contains no field beyond the documented contract", async () => {
    sessionFindManyMock.mockResolvedValue([row()])
    tenantFindManyMock.mockResolvedValue([{ id: "tenant-a", name: "Tenant A" }])

    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    const body = await readJson<any>(res)

    expect(Object.keys(body).sort()).toEqual(["data", "truncated"])
    expect(Object.keys(body.data[0]).sort()).toEqual(
      ["browser", "createdAt", "current", "id", "ipAddress", "lastSeenAt", "os", "tenantName", "userEmail", "userId"].sort(),
    )
    const serialised = JSON.stringify(body)
    expect(serialised).not.toMatch(/userAgent/i)
    expect(serialised).not.toMatch(/revokedAt/i)
  })

  it("falls back to the raw tenantId when the tenant row is missing", async () => {
    sessionFindManyMock.mockResolvedValue([row({ user: { email: "u1@example.com", tenantId: "ghost-tenant" } })])
    tenantFindManyMock.mockResolvedValue([])

    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    const body = await readJson<any>(res)

    expect(body.data[0].tenantName).toBe("ghost-tenant")
  })

  describe("bounding (never silently drop rows)", () => {
    it("requests MAX_SESSION_ROWS + 1 rows and reports truncated: false under the cap", async () => {
      sessionFindManyMock.mockResolvedValue([row()])
      tenantFindManyMock.mockResolvedValue([{ id: "tenant-a", name: "Tenant A" }])

      const GET = await importGET()
      const res = await callRoute(GET as any, { method: "GET" })
      const body = await readJson<any>(res)

      expect(sessionFindManyMock.mock.calls[0][0].take).toBe(501)
      expect(body.truncated).toBe(false)
      expect(body.data).toHaveLength(1)
    })

    it("truncates to 500 rows and reports truncated: true when the 501st row comes back", async () => {
      const rows = Array.from({ length: 501 }, (_, i) =>
        row({ id: `sess-${i}`, user: { email: `u${i}@example.com`, tenantId: "tenant-a" } }),
      )
      sessionFindManyMock.mockResolvedValue(rows)
      tenantFindManyMock.mockResolvedValue([{ id: "tenant-a", name: "Tenant A" }])

      const GET = await importGET()
      const res = await callRoute(GET as any, { method: "GET" })
      const body = await readJson<any>(res)

      expect(body.truncated).toBe(true)
      expect(body.data).toHaveLength(500)
      // The 500 kept are the first 500 as ordered by the query (lastSeenAt
      // desc), not an arbitrary subset — dropping the tail, not the head.
      expect(body.data[0].id).toBe("sess-0")
      expect(body.data[499].id).toBe("sess-499")
    })
  })

  describe("marking the caller's own session", () => {
    it("marks the row matching the token's sid current:true and every other row current:false", async () => {
      getTokenMock.mockResolvedValue({ sid: "sess-2" })
      sessionFindManyMock.mockResolvedValue([
        row({ id: "sess-1", user: { email: "u1@example.com", tenantId: "tenant-a" } }),
        row({ id: "sess-2", userId: "u2", user: { email: "u2@example.com", tenantId: "tenant-a" } }),
      ])
      tenantFindManyMock.mockResolvedValue([{ id: "tenant-a", name: "Tenant A" }])

      const GET = await importGET()
      const res = await callRoute(GET as any, { method: "GET" })
      const body = await readJson<any>(res)

      const bySid = new Map(body.data.map((s: any) => [s.id, s.current]))
      expect(bySid.get("sess-1")).toBe(false)
      expect(bySid.get("sess-2")).toBe(true)
    })

    it("marks every row current:false when the token has no sid", async () => {
      getTokenMock.mockResolvedValue({})
      sessionFindManyMock.mockResolvedValue([row({ id: "sess-1" })])
      tenantFindManyMock.mockResolvedValue([{ id: "tenant-a", name: "Tenant A" }])

      const GET = await importGET()
      const res = await callRoute(GET as any, { method: "GET" })
      const body = await readJson<any>(res)

      expect(body.data[0].current).toBe(false)
    })
  })
})

describe("DELETE /api/v1/admin/sessions", () => {
  async function importDELETE() {
    const mod = await import("./route")
    return mod.DELETE
  }

  it("is refused when the caller is not a super admin, before any write", async () => {
    const denial = new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
    requireSuperAdminCallerMock.mockResolvedValue(denial)

    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE" })

    expect(res.status).toBe(403)
    expect(sessionUpdateManyMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it("revokes every live session, the caller's own included", async () => {
    sessionUpdateManyMock.mockResolvedValue({ count: 7 })

    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: "DELETE" })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body).toEqual({ data: { revoked: 7 } })

    expect(sessionUpdateManyMock).toHaveBeenCalledTimes(1)
    const arg = sessionUpdateManyMock.mock.calls[0][0]
    // Total by design: no id exclusion, whatever the caller's token holds.
    expect(arg.where).toEqual({ revokedAt: null })
    expect(arg.data.revokedAt).toBeInstanceOf(Date)
  })

  it("writes one audit entry naming the action and the count", async () => {
    sessionUpdateManyMock.mockResolvedValue({ count: 3 })

    const DELETE = await importDELETE()
    await callRoute(DELETE as any, { method: "DELETE" })

    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: "sessions_revoked_all",
      category: "auth",
      status: "success",
      details: { by: "admin", revoked: 3 },
    })
    expect(auditMock.mock.calls[0][0].details).not.toHaveProperty("callerSessionKept")
  })
})
