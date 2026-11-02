import { beforeEach, describe, expect, it, vi } from "vitest"

// The dashboard filters the orchestrator alerts it merges with the very rule
// and inputs of the bell (orchestrator/alerts/active): same tenant source,
// same scope, same vDC VMIDs, same RBAC scope (alerts.view).
const h = vi.hoisted(() => ({
  visible: vi.fn(),
  tenantId: vi.fn(),
  connIds: vi.fn(),
  infra: vi.fn(),
  vmids: vi.fn(),
  rbac: vi.fn(),
}))

vi.mock("@/lib/alerts/visibility", () => ({ isAlertVisibleToTenant: (...a: any[]) => h.visible(...a) }))
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: (...a: any[]) => h.tenantId(...a),
  getTenantConnectionIds: (...a: any[]) => h.connIds(...a),
}))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: (...a: any[]) => h.infra(...a),
  maskingScope: (infra: any) => (infra?.kind === "iaas" ? infra.vdcScope : null),
}))
vi.mock("@/lib/alerts/vdcVmids", () => ({ getVdcVmidsByConnection: (...a: any[]) => h.vmids(...a) }))
vi.mock("@/lib/rbac", () => ({
  getCurrentRbacInfraScope: (...a: any[]) => h.rbac(...a),
  PERMISSIONS: { ALERTS_VIEW: "alerts.view" },
}))

import { filterAlertsVisibleToTenant } from "./tenantAlertFilter"

const a1 = { connection_id: "p1", type: "ceph_noout" }
const a2 = { connection_id: "p1", rule_id: "r1", type: "cpu" }

beforeEach(() => {
  vi.clearAllMocks()
  h.tenantId.mockResolvedValue("tenant-iaas")
  h.connIds.mockResolvedValue(new Set(["p1"]))
  h.infra.mockResolvedValue({ kind: "iaas", vdcScope: { connectionIds: new Set(["p1"]) } })
  h.vmids.mockResolvedValue(new Map([["p1", new Set(["100"])]]))
  h.rbac.mockResolvedValue(null)
})

describe("filterAlertsVisibleToTenant", () => {
  it("builds the context of the bell and keeps the alerts it lets through, in order", async () => {
    h.visible.mockImplementation(async (a: any) => a === a2)

    expect(await filterAlertsVisibleToTenant([a1, a2])).toEqual([a2])

    expect(h.infra).toHaveBeenCalledWith("tenant-iaas")
    expect(h.vmids).toHaveBeenCalledWith("tenant-iaas")
    expect(h.rbac).toHaveBeenCalledWith("alerts.view")
    expect(h.visible).toHaveBeenCalledWith(a1, {
      tenantId: "tenant-iaas",
      tenantConnectionIds: new Set(["p1"]),
      vdcScope: { connectionIds: new Set(["p1"]) },
      vdcVmids: new Map([["p1", new Set(["100"])]]),
      infraKind: "iaas",
      rbacScope: null,
    })
  })

  it("reads no vDC VMIDs for the provider or an msp", async () => {
    h.infra.mockResolvedValue({ kind: "provider" })
    h.visible.mockResolvedValue(true)

    expect(await filterAlertsVisibleToTenant([a1])).toEqual([a1])
    expect(h.vmids).not.toHaveBeenCalled()
    expect(h.visible.mock.calls[0][1]).toMatchObject({ infraKind: "provider", vdcScope: null, vdcVmids: undefined })
  })

  it("an empty list costs nothing", async () => {
    expect(await filterAlertsVisibleToTenant([])).toEqual([])
    expect(h.tenantId).not.toHaveBeenCalled()
  })

  it("fails closed: any error drops every alert", async () => {
    h.connIds.mockRejectedValue(new Error("db down"))
    expect(await filterAlertsVisibleToTenant([a1, a2])).toEqual([])

    h.connIds.mockResolvedValue(new Set(["p1"]))
    h.visible.mockRejectedValue(new Error("lookup failed"))
    expect(await filterAlertsVisibleToTenant([a1, a2])).toEqual([])
  })
})
