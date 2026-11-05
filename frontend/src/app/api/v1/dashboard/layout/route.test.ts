import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_LAYOUT } from "@/components/dashboard/types"
import { callRoute } from "../../../../../__tests__/setup/route-test"

// ── Hoist mocks ──────────────────────────────────────────────────────────────
const {
  mockGetServerSession,
  mockDemoResponse,
  mockGetCurrentTenantId,
  dashboardLayoutUpdateMany,
  dashboardLayoutUpsert,
  dashboardLayoutFindFirst,
  dashboardLayoutFindMany,
  dashboardLayoutDelete,
  dashboardLayoutDeleteMany,
  dashboardLayoutCreate,
  tenantFindUnique,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockDemoResponse: vi.fn(),
  mockGetCurrentTenantId: vi.fn(),
  dashboardLayoutUpdateMany: vi.fn(),
  dashboardLayoutUpsert: vi.fn(),
  dashboardLayoutFindFirst: vi.fn(),
  dashboardLayoutFindMany: vi.fn(),
  dashboardLayoutDelete: vi.fn(),
  dashboardLayoutDeleteMany: vi.fn(),
  dashboardLayoutCreate: vi.fn(),
  tenantFindUnique: vi.fn(),
}))

// Session-scoped prisma (tenant-scoped client)
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({
    dashboardLayout: {
      updateMany: dashboardLayoutUpdateMany,
      upsert: dashboardLayoutUpsert,
      findFirst: dashboardLayoutFindFirst,
      findMany: dashboardLayoutFindMany,
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
      create: dashboardLayoutCreate,
      delete: dashboardLayoutDelete,
      deleteMany: dashboardLayoutDeleteMany,
      update: vi.fn().mockResolvedValue({}),
    },
  }),
  getCurrentTenantId: () => mockGetCurrentTenantId(),
}))

// Global prisma (for tenant table lookups)
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: tenantFindUnique,
    },
  },
}))

vi.mock("next-auth", () => ({
  getServerSession: mockGetServerSession,
}))

vi.mock("@/lib/demo/demo-api", () => ({
  demoResponse: mockDemoResponse,
}))

vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockDemoResponse.mockReturnValue(null)
  mockGetServerSession.mockResolvedValue({ user: { id: "u1", tenantId: "default" } })
  mockGetCurrentTenantId.mockResolvedValue("default")
  dashboardLayoutUpdateMany.mockResolvedValue({})
  dashboardLayoutUpsert.mockResolvedValue({
    id: "layout-1",
    name: "Default",
    widgets: [],
    isActive: true,
    updatedAt: new Date(),
  })
  dashboardLayoutFindFirst.mockResolvedValue(null)
  dashboardLayoutFindMany.mockResolvedValue([])
  dashboardLayoutDelete.mockResolvedValue({})
  dashboardLayoutDeleteMany.mockResolvedValue({})
  dashboardLayoutCreate.mockResolvedValue({ id: "new-id", name: "Default", widgets: [], isActive: true, updatedAt: null })
  tenantFindUnique.mockResolvedValue(null)
})

// ── PUT tests ────────────────────────────────────────────────────────────────

describe("PUT /api/v1/dashboard/layout", () => {
  it("keys the upsert on { tenantId_userId_name } for a tenant session", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", tenantId: "msp-tenant-1" } })
    mockGetCurrentTenantId.mockResolvedValue("msp-tenant-1")

    const { PUT } = await import("./route")
    const res = await callRoute(PUT, {
      method: "PUT",
      body: { name: "Default", widgets: [{ id: "w1", type: "alerts" }] },
    })

    expect(res.status).toBe(200)

    expect(dashboardLayoutUpsert).toHaveBeenCalledOnce()
    const upsertCall = dashboardLayoutUpsert.mock.calls[0][0]
    expect(upsertCall.where).toEqual({
      tenantId_userId_name: { tenantId: "msp-tenant-1", userId: "u1", name: "Default" },
    })
  })

  it("uses the provider tenantId in the upsert key for a provider session", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u2", tenantId: "default" } })
    mockGetCurrentTenantId.mockResolvedValue("default")

    const { PUT } = await import("./route")
    const res = await callRoute(PUT, {
      method: "PUT",
      body: { name: "My Dashboard", widgets: [] },
    })

    expect(res.status).toBe(200)

    const upsertCall = dashboardLayoutUpsert.mock.calls[0][0]
    expect(upsertCall.where).toEqual({
      tenantId_userId_name: { tenantId: "default", userId: "u2", name: "My Dashboard" },
    })
  })

  it("returns 400 when widgets is missing", async () => {
    const { PUT } = await import("./route")
    const res = await callRoute(PUT, { method: "PUT", body: { name: "Default" } })
    expect(res.status).toBe(400)
    expect(dashboardLayoutUpsert).not.toHaveBeenCalled()
  })
})

// ── GET active-fallback tests ─────────────────────────────────────────────────

describe("GET /api/v1/dashboard/layout — active-layout fallback", () => {
  it("returns DEFAULT_LAYOUT widgets when no layout exists and tenant.operatingModel === 'msp'", async () => {
    mockGetCurrentTenantId.mockResolvedValue("msp-tenant-1")
    dashboardLayoutFindFirst.mockResolvedValue(null)
    tenantFindUnique.mockResolvedValue({ operatingModel: "msp" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.id).toBeNull()
    expect(body.data.name).toBe("Default")
    expect(body.data.widgets).toEqual(DEFAULT_LAYOUT)
  })

  it("returns empty widgets when no layout exists and tenant is provider (operatingModel null)", async () => {
    mockGetCurrentTenantId.mockResolvedValue("default")
    dashboardLayoutFindFirst.mockResolvedValue(null)
    tenantFindUnique.mockResolvedValue({ operatingModel: null })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.widgets).toEqual([])
  })

  it("returns empty widgets when no layout exists and tenant has operatingModel 'iaas'", async () => {
    mockGetCurrentTenantId.mockResolvedValue("iaas-tenant-1")
    dashboardLayoutFindFirst.mockResolvedValue(null)
    tenantFindUnique.mockResolvedValue({ operatingModel: "iaas" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.widgets).toEqual([])
  })

  it("returns empty widgets when no layout exists and prisma.tenant returns null (unknown tenant)", async () => {
    mockGetCurrentTenantId.mockResolvedValue("ghost-tenant")
    dashboardLayoutFindFirst.mockResolvedValue(null)
    tenantFindUnique.mockResolvedValue(null)

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.widgets).toEqual([])
  })

  it("returns the existing layout when one exists (no fallback needed)", async () => {
    const storedWidgets = [{ id: "w1", type: "alerts" }]
    dashboardLayoutFindFirst.mockResolvedValue({
      id: "layout-99",
      name: "Default",
      widgets: storedWidgets,
      isActive: true,
      updatedAt: new Date("2026-01-01"),
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.id).toBe("layout-99")
    expect(body.data.widgets).toEqual(storedWidgets)
    // tenant.findUnique must NOT be called when a layout row exists
    expect(tenantFindUnique).not.toHaveBeenCalled()
  })
})

// ── No live session ──────────────────────────────────────────────────────────

describe("dashboard layout without a live session", () => {
  beforeEach(() => {
    // The cookie still carries a valid JWT, but its server-side session is
    // revoked: getServerSession answers null.
    mockGetServerSession.mockResolvedValue(null)
  })

  it("GET answers 401 and never reads the user named in the query", async () => {
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET", searchParams: { list: "true", userId: "victim" } })
    expect(res.status).toBe(401)
    expect(dashboardLayoutFindMany).not.toHaveBeenCalled()
    expect(dashboardLayoutFindFirst).not.toHaveBeenCalled()
  })

  it("DELETE answers 401 and never deletes for the user named in the query", async () => {
    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE, { method: "DELETE", searchParams: { name: "Ops", userId: "victim" } })
    expect(res.status).toBe(401)
    expect(dashboardLayoutFindFirst).not.toHaveBeenCalled()
    expect(dashboardLayoutDelete).not.toHaveBeenCalled()
    const reset = await callRoute(DELETE, { method: "DELETE", searchParams: { userId: "victim" } })
    expect(reset.status).toBe(401)
    expect(dashboardLayoutDeleteMany).not.toHaveBeenCalled()
  })

  it("PATCH answers 401 and reorders nothing", async () => {
    const { PATCH } = await import("./route")
    const res = await callRoute(PATCH, { method: "PATCH", body: { order: ["Ops", "Default"] } })
    expect(res.status).toBe(401)
    expect(dashboardLayoutUpdateMany).not.toHaveBeenCalled()
  })

  it("PUT and POST answer 401 and write nothing", async () => {
    const { PUT, POST } = await import("./route")
    const put = await callRoute(PUT, { method: "PUT", body: { name: "Default", widgets: [] } })
    expect(put.status).toBe(401)
    expect(dashboardLayoutUpsert).not.toHaveBeenCalled()
    const post = await callRoute(POST, { method: "POST", body: { name: "Ops", widgets: [] } })
    expect(post.status).toBe(401)
    expect(dashboardLayoutCreate).not.toHaveBeenCalled()
  })
})
