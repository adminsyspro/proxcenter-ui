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
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const {
  requireSuperAdminCallerMock,
  sessionFindManyMock,
  tenantFindManyMock,
} = vi.hoisted(() => ({
  requireSuperAdminCallerMock: vi.fn(),
  sessionFindManyMock: vi.fn(),
  tenantFindManyMock: vi.fn(),
}))

vi.mock("@/lib/auth/totp-admin", () => ({
  requireSuperAdminCaller: requireSuperAdminCallerMock,
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    session: { findMany: sessionFindManyMock },
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
  sessionFindManyMock.mockResolvedValue([])
  tenantFindManyMock.mockResolvedValue([])
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

    expect(Object.keys(body.data[0]).sort()).toEqual(
      ["browser", "createdAt", "id", "ipAddress", "lastSeenAt", "os", "tenantName", "userEmail", "userId"].sort(),
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
})
