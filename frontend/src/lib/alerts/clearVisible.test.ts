/**
 * Codex QA-delta review finding 3: the orchestrator's clear operations are
 * connection-wide with no tenant concept. This helper is the non-provider
 * replacement — it must delete exactly the alerts the caller can SEE
 * (same visibility filter as the GET list) and nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAlertsMock, deleteAlertMock, isVisibleMock, getInfraMock, vdcVmidsMock, rbacScopeMock } = vi.hoisted(() => ({
  getAlertsMock: vi.fn(),
  deleteAlertMock: vi.fn(),
  isVisibleMock: vi.fn(),
  getInfraMock: vi.fn(),
  vdcVmidsMock: vi.fn(),
  rbacScopeMock: vi.fn(),
}))

import { FAKE_RBAC_SCOPE } from "@/__tests__/setup/rbacScope"

vi.mock("@/lib/orchestrator/client", () => ({
  alertsApi: {
    getAlerts: (...a: any[]) => getAlertsMock(...a),
    deleteAlert: (...a: any[]) => deleteAlertMock(...a),
  },
}))

vi.mock("@/lib/alerts/visibility", () => ({
  isAlertVisibleToTenant: (...a: any[]) => isVisibleMock(...a),
}))

vi.mock("@/lib/alerts/vdcVmids", () => ({
  getVdcVmidsByConnection: (...a: any[]) => vdcVmidsMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => "tenant-a",
  getTenantConnectionIds: async () => new Set(["c1"]),
}))

vi.mock("@/lib/rbac", () => ({
  getCurrentRbacInfraScope: (...a: any[]) => rbacScopeMock(...a),
  PERMISSIONS: { ALERTS_MANAGE: "alerts.manage" },
}))

// Keep the real maskingScope (pure function); only stub the scope resolver.
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

import { clearVisibleTenantAlerts } from "./clearVisible"

const ALERTS = [
  { id: 1, connection_id: "c1", vmid: "100" }, // ours
  { id: 2, connection_id: "c1", vmid: "999" }, // neighbour tenant, same shared cluster
  { id: 3, connection_id: "c1", vmid: "101" }, // ours
]

beforeEach(() => {
  vi.clearAllMocks()
  getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope: { connectionIds: new Set(["c1"]) } })
  vdcVmidsMock.mockResolvedValue(new Map([["c1", new Set(["100", "101"])]]))
  getAlertsMock.mockResolvedValue({ data: { data: ALERTS } })
  deleteAlertMock.mockResolvedValue({ data: { status: "ok" } })
  rbacScopeMock.mockReset().mockResolvedValue(null)
})

describe("clearVisibleTenantAlerts", () => {
  it("deletes exactly the visible alerts, by id, and returns the count", async () => {
    isVisibleMock.mockImplementation(async (a: any) => a.vmid !== "999")

    const cleared = await clearVisibleTenantAlerts("c1")

    expect(cleared).toBe(2)
    expect(getAlertsMock).toHaveBeenCalledWith({ connection_id: "c1", status: "active", limit: 500, offset: 0 })
    expect(deleteAlertMock).toHaveBeenCalledTimes(2)
    expect(deleteAlertMock).toHaveBeenCalledWith("1")
    expect(deleteAlertMock).toHaveBeenCalledWith("3")
  })

  it("deletes nothing when no alert is visible", async () => {
    isVisibleMock.mockResolvedValue(false)

    const cleared = await clearVisibleTenantAlerts("c1")

    expect(cleared).toBe(0)
    expect(deleteAlertMock).not.toHaveBeenCalled()
  })

  it("tolerates a non-array orchestrator payload", async () => {
    getAlertsMock.mockResolvedValue({ data: { data: null } })

    const cleared = await clearVisibleTenantAlerts()

    expect(cleared).toBe(0)
    expect(deleteAlertMock).not.toHaveBeenCalled()
  })
})

describe("RBAC infra scope forwarding (issue #525)", () => {
  beforeEach(() => {
    isVisibleMock.mockResolvedValue(true)
  })

  it("forwards the resolved RBAC scope", async () => {
    rbacScopeMock.mockResolvedValue(FAKE_RBAC_SCOPE)

    const cleared = await clearVisibleTenantAlerts("c1")

    expect(cleared).toBe(3)
    expect(isVisibleMock.mock.calls[0][1].rbacScope).toBe(FAKE_RBAC_SCOPE)
    expect(rbacScopeMock).toHaveBeenCalledWith("alerts.manage")
  })

  it("forwards null for an unrestricted caller", async () => {
    const cleared = await clearVisibleTenantAlerts("c1")

    expect(cleared).toBe(3)
    expect(isVisibleMock.mock.calls[0][1].rbacScope).toBeNull()
  })
})
