/**
 * Codex QA-delta review finding 3: DELETE /api/v1/orchestrator/alerts/clear
 * looped the orchestrator's connection-WIDE /alerts/clear over the tenant
 * union — on a shared cluster that wiped the neighbours' alerts. Non-provider
 * callers now clear per visible alert (clearVisibleTenantAlerts); the
 * provider keeps the orchestrator-native per-connection clears.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, rbacScopeMock, getCurrentTenantIdMock, tenantConnectionIdsMock, clearAllMock, clearVisibleMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  rbacScopeMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
  clearAllMock: vi.fn(),
  clearVisibleMock: vi.fn(),
}))

vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: () => null }))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  getCurrentRbacInfraScope: (...a: any[]) => rbacScopeMock(...a),
  PERMISSIONS: { ALERTS_MANAGE: "alerts.manage" },
}))

vi.mock("@/lib/tenant", () => ({
  DEFAULT_TENANT_ID: "default",
  getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a),
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a),
}))

vi.mock("@/lib/orchestrator/client", () => ({
  alertsApi: { clearAll: (...a: any[]) => clearAllMock(...a) },
}))

vi.mock("@/lib/alerts/clearVisible", () => ({
  clearVisibleTenantAlerts: (...a: any[]) => clearVisibleMock(...a),
}))

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  rbacScopeMock.mockResolvedValue(null)
  clearAllMock.mockResolvedValue({ data: { status: "ok" } })
  clearVisibleMock.mockResolvedValue(3)
})

describe("DELETE /api/v1/orchestrator/alerts/clear — scoping", () => {
  it("404s a connection_id outside the caller's perimeter", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE", searchParams: { connection_id: "c-foreign" } })
    expect(res.status).toBe(404)
    expect(clearAllMock).not.toHaveBeenCalled()
    expect(clearVisibleMock).not.toHaveBeenCalled()
  })

  it("non-provider clears per VISIBLE alert, never via the orchestrator connection-wide clear", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE", searchParams: { connection_id: "c1" } })
    expect(res.status).toBe(200)
    expect(clearVisibleMock).toHaveBeenCalledWith("c1")
    expect(clearAllMock).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ cleared: 3 })
  })

  it("non-provider without connection_id also goes through the visible-alert path", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(clearVisibleMock).toHaveBeenCalledWith(undefined)
    expect(clearAllMock).not.toHaveBeenCalled()
  })

  // The orchestrator has no /alerts/clear route: the call deleted an alert
  // whose id is "clear" and left every alert open (roadmap#223).
  it("provider resolves the active alerts of each of its connections through the orchestrator's clear", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(clearVisibleMock).not.toHaveBeenCalled()
    expect(clearAllMock.mock.calls).toEqual([["c1"], ["c2"]])
    expect(await res.json()).toEqual({ cleared: 2 })
  })

  it("provider clears one connection when it names it", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE", searchParams: { connection_id: "c2" } })
    expect(res.status).toBe(200)
    expect(clearAllMock.mock.calls).toEqual([["c2"]])
    expect(await res.json()).toEqual({ status: "ok" })
  })

  // roadmap#223: alerts.manage scoped to a node or a VM is not a fleet-wide right.
  it("clears only what a provider caller with a scoped alerts.manage sees", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))
    rbacScopeMock.mockResolvedValue({ connectionIds: new Set(["c1"]) })

    const { DELETE } = await import("./route")
    const res = await callRoute(DELETE as any, { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(rbacScopeMock).toHaveBeenCalledWith("alerts.manage")
    expect(clearVisibleMock).toHaveBeenCalledWith(undefined, "resolve")
    expect(clearAllMock).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ cleared: 3 })
  })
})
