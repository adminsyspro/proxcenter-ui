/**
 * Task 15 (security), Task 12 Step 5 verdict: DELETE /api/v1/orchestrator/alerts
 * with no connection_id wipes the orchestrator's ENTIRE active-alert set (the
 * Go orchestrator's clearAll has no tenant concept). A non-provider caller
 * must now be REQUIRED to pass a connection_id inside their own perimeter;
 * the provider keeps its unrestricted fleet-wide clear.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, getCurrentTenantIdMock, tenantConnectionIdsMock, clearAllMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
  clearAllMock: vi.fn(),
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

  it("clears alerts for a non-provider tenant whose connection_id is in their perimeter", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE", searchParams: { connection_id: "c1" } })
    expect(res.status).toBe(200)
    expect(clearAllMock).toHaveBeenCalledWith("c1")
  })

  it("allows the provider to clear all alerts fleet-wide without a connection_id", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(clearAllMock).toHaveBeenCalledWith(undefined)
  })
})
