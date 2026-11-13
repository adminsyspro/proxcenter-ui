import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  infra: vi.fn(),
  mask: vi.fn(),
  rbacScope: vi.fn(),
  snapshot: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: async () => "default" }))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: (...a: unknown[]) => m.infra(...a),
  maskingScope: (...a: unknown[]) => m.mask(...a),
}))
vi.mock("@/lib/rbac", () => ({ getCurrentRbacInfraScope: (...a: unknown[]) => m.rbacScope(...a) }))
vi.mock("@/lib/tools/snapshot", () => ({ collectInventorySnapshot: (...a: unknown[]) => m.snapshot(...a) }))

import { localAlertFilter, refuseRestrictedAlertWrite, visibleLocalAlertIds } from "./localAlertScope"

const snapshot = {
  clusters: [{ id: "c1", name: "PVE-PROD" }],
  nodes: [{ name: "pve1", cluster: "PVE-PROD" }],
  guests: [{ vmid: "101", name: "web", cluster: "PVE-PROD" }],
  restricted: true,
}

const row = (id: string, entityType: string, entityId: string, source = "PVE-PROD") =>
  ({ id, entityType, entityId, entityName: entityId, source })

beforeEach(() => {
  vi.clearAllMocks()
  m.infra.mockResolvedValue({ kind: "provider" })
  m.mask.mockReturnValue(null)
  m.rbacScope.mockResolvedValue(null)
  m.snapshot.mockResolvedValue(snapshot)
})

describe("localAlertFilter", () => {
  it("is null, every row visible, for a caller nothing restricts", async () => {
    expect(await localAlertFilter("alerts.manage")).toBeNull()
    expect(m.rbacScope).toHaveBeenCalledWith("alerts.manage")
    expect(m.snapshot).not.toHaveBeenCalled()
  })

  it("keeps the hosts, guests and clusters of a scoped caller's inventory", async () => {
    m.rbacScope.mockResolvedValue({ connectionIds: new Set(["c1"]) })
    const visible = (await localAlertFilter("alerts.view"))!
    // The inventory as the permission given reaches it, not every grant (roadmap#223).
    expect(m.snapshot).toHaveBeenCalledWith({ permission: "alerts.view" })
    expect(visible(row("a", "node", "pve1"))).toBe(true)
    expect(visible(row("b", "node", "pve2"))).toBe(false)
    expect(visible(row("c", "vm", "101"))).toBe(true)
    expect(visible(row("d", "cluster", "c1"))).toBe(true)
    expect(visible(row("e", "pbs", "backup-1"))).toBe(false)
  })

  it("narrows a vDC tenant even with a global grant", async () => {
    m.mask.mockReturnValue({ connectionIds: new Set(["c1"]) })
    expect(await localAlertFilter("alerts.view")).not.toBeNull()
  })

  it("ignores the view context a provider admin browses with", async () => {
    await localAlertFilter("alerts.view")
    expect(m.infra).toHaveBeenCalledWith("default", { ignoreVdcContext: true })
  })
})

describe("visibleLocalAlertIds", () => {
  it("returns the ids as given, without reading them, for a caller nothing restricts", async () => {
    expect(await visibleLocalAlertIds(["a", "b"], "alerts.manage", m.findMany)).toEqual(["a", "b"])
    expect(m.findMany).not.toHaveBeenCalled()
  })

  it("keeps the rows a scoped caller sees", async () => {
    m.rbacScope.mockResolvedValue({ connectionIds: new Set(["c1"]) })
    m.findMany.mockResolvedValue([row("a", "node", "pve1"), row("b", "node", "pve2")])
    expect(await visibleLocalAlertIds(["a", "b", "zz"], "alerts.manage", m.findMany)).toEqual(["a"])
    expect(m.findMany).toHaveBeenCalledWith(["a", "b", "zz"])
  })
})

describe("refuseRestrictedAlertWrite", () => {
  it("lets a caller nothing restricts through", async () => {
    expect(await refuseRestrictedAlertWrite()).toBeNull()
    expect(m.rbacScope).toHaveBeenCalledWith("alerts.manage")
  })

  it("refuses a scoped caller with a 403, without building its inventory", async () => {
    m.rbacScope.mockResolvedValue({ connectionIds: new Set(["c1"]) })
    const res = await refuseRestrictedAlertWrite()
    expect(res?.status).toBe(403)
    expect(m.snapshot).not.toHaveBeenCalled()
  })
})
