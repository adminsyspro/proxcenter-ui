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
  tenantFindUnique,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockDemoResponse: vi.fn(),
  mockGetCurrentTenantId: vi.fn(),
  dashboardLayoutUpdateMany: vi.fn(),
  dashboardLayoutUpsert: vi.fn(),
  dashboardLayoutFindFirst: vi.fn(),
  tenantFindUnique: vi.fn(),
}))

// Session-scoped prisma (tenant-scoped client)
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({
    dashboardLayout: {
      updateMany: dashboardLayoutUpdateMany,
      upsert: dashboardLayoutUpsert,
      findFirst: dashboardLayoutFindFirst,
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
      create: vi.fn().mockResolvedValue({ id: "new-id", name: "Default", widgets: [], isActive: true, updatedAt: null }),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
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
