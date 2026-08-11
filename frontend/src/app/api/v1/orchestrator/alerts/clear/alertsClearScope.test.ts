/**
 * Codex QA-delta review finding 3: DELETE /api/v1/orchestrator/alerts/clear
 * looped the orchestrator's connection-WIDE /alerts/clear over the tenant
 * union — on a shared cluster that wiped the neighbours' alerts. Non-provider
 * callers now clear per visible alert (clearVisibleTenantAlerts); the
 * provider keeps the orchestrator-native per-connection clears.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, getCurrentTenantIdMock, tenantConnectionIdsMock, orchestratorFetchMock, clearVisibleMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
  orchestratorFetchMock: vi.fn(),
  clearVisibleMock: vi.fn(),
}))

vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: () => null }))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ALERTS_MANAGE: "alerts.manage" },
}))

vi.mock("@/lib/tenant", () => ({
  DEFAULT_TENANT_ID: "default",
  getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a),
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a),
}))

vi.mock("@/lib/orchestrator/client", () => ({
  orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a),
}))

vi.mock("@/lib/alerts/clearVisible", () => ({
  clearVisibleTenantAlerts: (...a: any[]) => clearVisibleMock(...a),
}))

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  orchestratorFetchMock.mockResolvedValue({ status: "ok" })
  clearVisibleMock.mockResolvedValue(3)
})

describe("DELETE /api/v1/orchestrator/alerts/clear — scoping", () => {
  it("404s a connection_id outside the caller's perimeter", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE", searchParams: { connection_id: "c-foreign" } })
    expect(res.status).toBe(404)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
    expect(clearVisibleMock).not.toHaveBeenCalled()
  })

  it("non-provider clears per VISIBLE alert, never via the orchestrator connection-wide clear", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE", searchParams: { connection_id: "c1" } })
    expect(res.status).toBe(200)
    expect(clearVisibleMock).toHaveBeenCalledWith("c1")
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ cleared: 3 })
  })

  it("non-provider without connection_id also goes through the visible-alert path", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(clearVisibleMock).toHaveBeenCalledWith(undefined)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it("provider keeps the orchestrator-native per-connection clears", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(clearVisibleMock).not.toHaveBeenCalled()
    expect(orchestratorFetchMock).toHaveBeenCalledTimes(2)
    expect(orchestratorFetchMock).toHaveBeenCalledWith("/alerts/clear?connection_id=c1", { method: "DELETE" })
    expect(orchestratorFetchMock).toHaveBeenCalledWith("/alerts/clear?connection_id=c2", { method: "DELETE" })
  })
})
