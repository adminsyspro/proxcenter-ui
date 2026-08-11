/**
 * Task 15 (security), Task 12 Step 5 verdict: DELETE /api/v1/orchestrator/alerts
 * with no connection_id wipes the orchestrator's ENTIRE active-alert set (the
 * Go orchestrator's clearAll has no tenant concept). A non-provider caller
 * must be REQUIRED to pass a connection_id inside their own perimeter; the
 * provider keeps its unrestricted fleet-wide clear.
 *
 * Codex QA-delta review finding 3 tightened this further: even scoped to a
 * connection, clearAll is connection-WIDE, so on a shared cluster a tenant
 * admin wiped the neighbours' alerts. Non-provider callers now go through
 * clearVisibleTenantAlerts (per-visible-alert deletes) and never reach the
 * orchestrator's clearAll.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, getCurrentTenantIdMock, tenantConnectionIdsMock, clearAllMock, clearVisibleMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
  clearAllMock: vi.fn(),
  clearVisibleMock: vi.fn(),
}))

vi.mock("@/lib/alerts/clearVisible", () => ({
  clearVisibleTenantAlerts: (...a: any[]) => clearVisibleMock(...a),
}))

vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: () => null }))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ALERTS_MANAGE: "alerts.manage", CONNECTION_VIEW: "connection.view" },
}))

vi.mock("@/lib/tenant", () => ({
  DEFAULT_TENANT_ID: "default",
  getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a),
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a),
  getSessionPrisma: vi.fn(),
}))

vi.mock("@/lib/orchestrator/client", () => ({
  alertsApi: { clearAll: (...a: any[]) => clearAllMock(...a) },
}))

vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: vi.fn(),
  maskingScope: vi.fn(),
}))
vi.mock("@/lib/alerts/visibility", () => ({ isAlertVisibleToTenant: vi.fn() }))
vi.mock("@/lib/alerts/vdcVmids", () => ({ getVdcVmidsByConnection: vi.fn() }))
vi.mock("@/lib/alerts/orchestratorFingerprint", () => ({ buildOrchestratorFingerprint: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  clearAllMock.mockResolvedValue({ data: { status: "ok" } })
  clearVisibleMock.mockResolvedValue(2)
})

describe("DELETE /api/v1/orchestrator/alerts — clear-all scoping", () => {
  it("400s a non-provider tenant that omits connection_id", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE" })
    expect(res.status).toBe(400)
    expect(clearAllMock).not.toHaveBeenCalled()
  })

  it("404s a non-provider tenant whose connection_id is outside their perimeter", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE", searchParams: { connection_id: "c-foreign" } })
    expect(res.status).toBe(404)
    expect(clearAllMock).not.toHaveBeenCalled()
  })

  it("non-provider with an in-perimeter connection_id clears per VISIBLE alert, never via the orchestrator clearAll", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE", searchParams: { connection_id: "c1" } })
    expect(res.status).toBe(200)
    expect(clearVisibleMock).toHaveBeenCalledWith("c1")
    expect(clearAllMock).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ cleared: 2 })
  })

  it("allows the provider to clear all alerts fleet-wide without a connection_id", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(clearAllMock).toHaveBeenCalledWith(undefined)
  })
})
