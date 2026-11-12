import { beforeEach, describe, expect, it, vi } from "vitest"

// roadmap#224: the alert events the browser relays are kept only when the
// caller could have read them on GET /api/v1/events.
const h = vi.hoisted(() => ({
  tenantId: "default",
  infra: { kind: "provider" } as any,
  tenantConnections: new Set<string>(["prod", "dr"]),
  vdcVmids: new Map<string, Set<string>>(),
  rbac: null as any,
  getVdcVmids: vi.fn(),
  rbacScope: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  DEFAULT_TENANT_ID: "default",
  getCurrentTenantId: async () => h.tenantId,
  getTenantConnectionIds: async () => h.tenantConnections,
}))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: async () => h.infra,
}))
vi.mock("./vdcVmids", () => ({ getVdcVmidsByConnection: (...a: unknown[]) => h.getVdcVmids(...a) }))
vi.mock("@/lib/rbac", () => ({
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
  getCurrentRbacInfraScope: (...a: unknown[]) => h.rbacScope(...a),
}))

import { isRelayedEventVisible, resolveRelayScope, scopeRelayedEvents, type RelayScope } from "./eventRelayScope"

const task = (connectionId: string | undefined, node: string, vmid?: string) => ({
  ...(connectionId === undefined ? {} : { connectionId }),
  id: `UPID:${node}:0001:0002:0003:qmstart:${vmid ?? ""}:root@pam:`,
  category: "task", level: "info", type: "qmstart", node, entity: vmid ?? node,
})
const log = (connectionId: string, node: string) => ({ connectionId, id: `${connectionId}-log-1`, category: "log", level: "error", type: "pvedaemon", node, entity: node })

const vdc = {
  kind: "iaas",
  vdcScope: { connectionIds: new Set(["prod"]), nodesByConnection: new Map([["prod", new Set(["pve1", "pve2", "pve3"])]]) },
}

beforeEach(() => {
  h.tenantId = "default"
  h.infra = { kind: "provider" }
  h.tenantConnections = new Set(["prod", "dr"])
  h.rbac = null
  h.getVdcVmids.mockReset().mockImplementation(async () => new Map([["prod", new Set(["106", "110"])]]))
  h.rbacScope.mockReset().mockImplementation(async () => h.rbac)
})

describe("scopeRelayedEvents", () => {
  it("passes everything the provider's unrestricted feed holds, connection-less events included", async () => {
    const events = [task("prod", "pve3", "7201"), task("dr", "pve1-dr"), log("prod", "pve1"), task(undefined, "pve2")]
    expect(await scopeRelayedEvents(events)).toEqual(events)
    expect(h.rbacScope).toHaveBeenCalledWith("connection.view")
    expect(h.getVdcVmids).not.toHaveBeenCalled()
  })

  it("keeps a vDC tenant's own guests and drops a neighbour's guest, a node task, a log and a connection-less event", async () => {
    h.tenantId = "tenant-vdc"
    h.infra = vdc
    const own = task("prod", "pve3", "106")
    const kept = await scopeRelayedEvents([own, task("prod", "pve3", "7201"), task("prod", "pve2"), log("prod", "pve1"), task(undefined, "pve2", "106"), task("dr", "pve1-dr", "106")])
    expect(kept).toEqual([own])
    expect(h.getVdcVmids).toHaveBeenCalledWith("tenant-vdc")
  })

  it("keeps an MSP's own connections only, and never a connection-less event", async () => {
    h.tenantId = "tenant-msp"
    h.infra = { kind: "msp", connectionIds: new Set(["own"]) }
    h.tenantConnections = new Set(["own"])
    const mine = [task("own", "pve1", "100"), log("own", "pve1")]
    expect(await scopeRelayedEvents([...mine, task("prod", "pve1", "100"), task(undefined, "pve1")])).toEqual(mine)
  })

  it("narrows to the caller's node and guest grants", async () => {
    h.rbac = {
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["prod", new Set(["pve1"])]]),
      nodeGrantsByConnection: new Map([["prod", new Set(["pve1"])]]),
      guestGrantsByConnection: new Map([["prod", new Set(["7201"])]]),
      guestDerived: false,
    }
    const kept = await scopeRelayedEvents([task("prod", "pve1"), task("prod", "pve3", "7201"), task("prod", "pve3", "116"), log("prod", "pve1"), log("prod", "pve2"), task("dr", "pve1-dr"), task(undefined, "pve1")])
    expect(kept).toEqual([task("prod", "pve1"), task("prod", "pve3", "7201"), log("prod", "pve1")])
  })

  it("forwards only the checked keys: a second spelling of a field never reaches the orchestrator", async () => {
    h.tenantId = "tenant-vdc"
    h.infra = vdc
    const forged = { ...task("prod", "pve3", "106"), CONNECTIONID: "dr", Node: "pve1-dr", ENTITY: "999", connectionid: "dr", initiatedBy: { email: "x" }, durationSec: 3, entityName: null }
    const [kept] = await scopeRelayedEvents([forged])
    expect(kept).toEqual(task("prod", "pve3", "106"))
    expect(Object.keys(kept).every(k => k === k.replace(/[A-Z]{2,}/, ""))).toBe(true)
    expect(JSON.stringify(kept)).not.toMatch(/"dr"|pve1-dr|999/)
  })

  it("takes an MSP's connections from its own clusters, not from vDC rows it may still carry", async () => {
    h.tenantId = "tenant-msp"
    h.infra = { kind: "msp", connectionIds: new Set(["own"]) }
    h.tenantConnections = new Set(["own", "prod"])
    const mine = task("own", "pve1", "100")
    expect(await scopeRelayedEvents([mine, task("prod", "pve1", "100")])).toEqual([mine])
  })

  it("keeps the whole feed as GET /api/v1/events builds it (parity)", async () => {
    // Shape of the route's output: extra fields the orchestrator does not read are dropped, nothing else.
    const feed = [
      { id: "UPID:pve3:000A1B2C:0F00D1E2:6740A1B2:qmstart:106:root@pam:", ts: "2026-11-12T07:00:00.000Z", endTs: null, level: "info", category: "task", type: "qmstart", typeLabel: "qmstart", entity: "106", entityName: "Debian-vDC", node: "pve3", user: "root@pam", status: "OK", duration: "1s", durationSec: 1, message: "qmstart (Debian-vDC) - OK", connectionId: "prod", connectionName: "PVE-PROD", source: "proxmox-task", initiatedBy: { email: "a@b" } },
      { id: "UPID:pve2:000A1B2D:0F00D1E3:6740A1B3:aptupdate::root@pam:", ts: "2026-11-12T07:00:00.000Z", level: "info", category: "task", type: "aptupdate", typeLabel: "aptupdate", entity: "pve2", entityName: null, node: "pve2", user: "root@pam", status: "running", message: "aptupdate - running", connectionId: "prod", connectionName: "PVE-PROD", source: "proxmox-task" },
      { id: "prod-log-4242", ts: "2026-11-12T07:00:00.000Z", level: "error", category: "log", type: "corosync", typeLabel: "corosync", entity: "pve1", node: "pve1", user: "system", status: null, message: "link down", connectionId: "prod", connectionName: "PVE-PROD", source: "proxmox-log" },
    ]
    const kept = await scopeRelayedEvents(feed)
    expect(kept).toHaveLength(feed.length)
    expect(kept[0]).toMatchObject({ id: feed[0].id, entity: "106", node: "pve3", connectionId: "prod", entityName: "Debian-vDC" })
    expect(kept[0]).not.toHaveProperty("initiatedBy")
    expect(kept[2]).not.toHaveProperty("status")
  })

  it("does not resolve anything for an empty batch", async () => {
    expect(await scopeRelayedEvents([])).toEqual([])
    expect(h.rbacScope).not.toHaveBeenCalled()
  })
})

describe("isRelayedEventVisible", () => {
  const provider: RelayScope = { tenantId: "default", connectionIds: new Set(["prod"]), vdcScope: null, vdcVmids: null, rbacScope: null }

  it("drops what the feed never produces: non-objects, other categories, a non-string connection", () => {
    for (const e of [null, "x", 42, [task("prod", "pve1")], { ...task("prod", "pve1"), category: "alert" }, { ...task("prod", "pve1"), connectionId: 7 }, { ...task("prod", "pve1"), connectionId: "" }]) {
      expect(isRelayedEventVisible(e, provider), JSON.stringify(e)).toBe(false)
    }
  })

  it("ties the event id to what was checked: the orchestrator remembers ids across tenants", () => {
    // A task id is its UPID, which names the node; a log id names its connection.
    expect(isRelayedEventVisible({ ...task("prod", "pve1"), id: "UPID:pve2:0001:0002:0003:qmstart::root@pam:" }, provider)).toBe(false)
    expect(isRelayedEventVisible({ ...task("prod", "pve1"), id: "evt-1" }, provider)).toBe(false)
    expect(isRelayedEventVisible({ ...task("prod", "pve1"), id: undefined }, provider)).toBe(false)
    expect(isRelayedEventVisible({ ...log("prod", "pve1"), id: "dr-log-1" }, provider)).toBe(false)
    expect(isRelayedEventVisible({ ...log("prod", "pve1"), id: "UPID:pve1:0001:0002:0003:qmstart::root@pam:" }, provider)).toBe(false)
    expect(isRelayedEventVisible(task("prod", "pve1"), provider)).toBe(true)
    expect(isRelayedEventVisible(log("prod", "pve1"), provider)).toBe(true)
  })

  it("takes only the id shapes the feed produces, bound to the checked node and guest", () => {
    // Alert visibility reads the guest from the UPID's 7th field: it must be the entity that was checked.
    expect(isRelayedEventVisible({ ...task("prod", "pve1", "106"), id: "UPID:pve1:0001:0002:0003:qmstart:7201:root@pam:" }, provider)).toBe(false)
    expect(isRelayedEventVisible({ ...task("prod", "pve1"), id: "UPID:pve1:0001:0002:0003:aptupdate:7201:root@pam:" }, provider)).toBe(false)
    expect(isRelayedEventVisible({ ...task("prod", "pve1", "106"), id: "UPID:pve1:0001:0002:0003:qmstart:106:root@pam:@prod/pve2" }, provider)).toBe(false)
    expect(isRelayedEventVisible({ ...task("prod", "pve1", "106"), id: "UPID:pve1:0001:0002:0003:qmstart:106:root@pam:x:" }, provider)).toBe(false)
    // A log id is "<connection>-log-<uid>", and a log line is about its node.
    expect(isRelayedEventVisible({ ...log("prod", "pve1"), id: "prod-log-500@prod/pve2" }, provider)).toBe(false)
    expect(isRelayedEventVisible({ ...log("prod", "pve1"), id: "prod-log-" }, provider)).toBe(false)
    expect(isRelayedEventVisible({ ...log("prod", "pve1"), entity: "pve2" }, provider)).toBe(false)
    expect(isRelayedEventVisible({ ...log("prod", "pve1"), entity: undefined }, provider)).toBe(true)
  })

  it("drops a task without a node, which the feed never produces", () => {
    const { node: _n, ...noNode } = task("prod", "pve1", "106")
    expect(isRelayedEventVisible(noNode, provider)).toBe(false)
  })

  it("drops a connection outside the tenant's", () => {
    expect(isRelayedEventVisible(task("other", "pve1"), provider)).toBe(false)
  })

  it("fails closed on a vDC connection whose nodes or pool did not resolve", () => {
    const s: RelayScope = { tenantId: "t", connectionIds: new Set(["prod"]), vdcScope: { connectionIds: new Set(["prod"]), nodesByConnection: new Map() } as any, vdcVmids: new Map(), rbacScope: null }
    expect(isRelayedEventVisible(task("prod", "pve1", "106"), s)).toBe(false)
  })

  it("keeps the provider's connection-less event only with an unrestricted perimeter", () => {
    const scoped = { ...provider, rbacScope: { fullConnections: new Set(["prod"]), nodesByConnection: new Map(), guestDerived: false } as any }
    expect(isRelayedEventVisible(task(undefined, "pve1"), provider)).toBe(true)
    expect(isRelayedEventVisible(task(undefined, "pve1"), scoped)).toBe(false)
    expect(isRelayedEventVisible(task("prod", "pve1"), scoped)).toBe(true)
  })
})

describe("resolveRelayScope", () => {
  it("takes a vDC tenant's connections from its vDCs, not from the tenant's own rows", async () => {
    h.tenantId = "tenant-vdc"
    h.infra = vdc
    h.tenantConnections = new Set(["prod", "pbs"])
    const s = await resolveRelayScope()
    expect([...s.connectionIds]).toEqual(["prod"])
    expect(s.vdcScope).toBe(vdc.vdcScope)
    expect(s.vdcVmids?.get("prod")).toEqual(new Set(["106", "110"]))
  })
})
