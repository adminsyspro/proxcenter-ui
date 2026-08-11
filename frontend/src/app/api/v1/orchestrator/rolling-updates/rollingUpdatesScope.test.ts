/**
 * Codex QA-delta review finding 4: the list filter kept rows with no
 * connection_id for every caller ("no key = pass"). Deny-by-default now:
 * an unlinked rolling update is provider-only, same rule as the jobs and
 * changes feeds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { getInfraMock, getCurrentTenantIdMock, tenantConnectionIdsMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
}))

// Keep the real maskingScope (pure function); only stub the scope resolver.
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a),
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a),
  getSessionPrisma: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { AUTOMATION_VIEW: "automation.view", AUTOMATION_EXECUTE: "automation.execute" },
}))

vi.mock("@/lib/orchestrator/headers", () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => extra,
}))

const ROWS = [
  { id: "ru-c1", connection_id: "c1", status: "running" },
  { id: "ru-c2", connection_id: "c2", status: "running" },
  { id: "ru-none", status: "running" },
]

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: ROWS }) }))
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ data: ROWS }) }))
})

describe("GET /api/v1/orchestrator/rolling-updates — tenant scoping", () => {
  it("provider: keeps every row, including one with no connection linkage", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    getInfraMock.mockResolvedValue({ kind: "provider" })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.map((r: any) => r.id)).toEqual(["ru-c1", "ru-c2", "ru-none"])
  })

  it("iaas: keeps only rows inside the narrowed vDC perimeter — unlinked row DENIED", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope: { connectionIds: new Set(["c1"]) } })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.map((r: any) => r.id)).toEqual(["ru-c1"])
  })

  it("msp: owned-connection union applies — unlinked row DENIED", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-msp")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.map((r: any) => r.id)).toEqual(["ru-c1"])
  })
})
