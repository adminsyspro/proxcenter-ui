/**
 * A vDC tenant only sees the "vm"/"ct" records written while the guest sat in
 * one of its vDC pools (deny-by-default). The current owner of the VMID is no
 * mask: a reused ID would hand a tenant the history of the guest it replaced.
 */
import { describe, expect, it } from "vitest"

import { isChangeVisibleToTenant, type ChangeVisibilityCtx } from "./visibility"

const iaasCtx = (over: Partial<ChangeVisibilityCtx> = {}): ChangeVisibilityCtx => ({
  infraKind: "iaas",
  tenantConnectionIds: new Set(["c1", "c2"]),
  vdcScope: {
    connectionIds: new Set(["c1"]),
    pbsConnectionIds: new Set<string>(),
    nodesByConnection: new Map([["c1", new Set(["n1"])]]),
    poolsByConnection: new Map([["c1", new Set(["pool-a"])]]),
  } as any,
  ...over,
})

const VM_OWNED = { connectionId: "c1", node: "n1", resourceType: "vm", resourceId: "100", pool: "pool-a" }

describe("isChangeVisibleToTenant", () => {
  it("cluster-less record: provider only", () => {
    const record = { node: "n1", resourceType: "vm", resourceId: "100" }
    expect(isChangeVisibleToTenant(record, iaasCtx({ infraKind: "provider", vdcScope: undefined }))).toBe(true)
    expect(isChangeVisibleToTenant(record, iaasCtx({ infraKind: "msp", vdcScope: undefined }))).toBe(false)
    expect(isChangeVisibleToTenant(record, iaasCtx())).toBe(false)
  })

  it("no vDC scope (provider/msp): connection membership decides, resource type does not", () => {
    const ctx = iaasCtx({ infraKind: "msp", vdcScope: undefined })
    expect(isChangeVisibleToTenant({ connectionId: "c1", resourceType: "node", resourceId: "n1" }, ctx)).toBe(true)
    expect(isChangeVisibleToTenant({ connectionId: "c-foreign", resourceType: "vm", resourceId: "100" }, ctx)).toBe(false)
  })

  it("iaas: keeps a guest record written while the guest sat in a vDC pool (vm and ct)", () => {
    expect(isChangeVisibleToTenant(VM_OWNED, iaasCtx())).toBe(true)
    expect(isChangeVisibleToTenant({ ...VM_OWNED, resourceType: "ct" }, iaasCtx())).toBe(true)
  })

  it("iaas: drops a neighbour tenant's VM on the same shared connection", () => {
    expect(isChangeVisibleToTenant({ ...VM_OWNED, resourceId: "999", pool: "pool-b" }, iaasCtx())).toBe(false)
  })

  it("iaas: drops non-guest records (node / storage / pool are provider infra concerns)", () => {
    expect(isChangeVisibleToTenant({ connectionId: "c1", node: "n1", resourceType: "node", resourceId: "n1" }, iaasCtx())).toBe(false)
    expect(isChangeVisibleToTenant({ connectionId: "c1", node: "n1", resourceType: "storage", resourceId: "local-lvm" }, iaasCtx())).toBe(false)
    expect(isChangeVisibleToTenant({ connectionId: "c1", node: "n1", resourceType: "pool", resourceId: "pool-b" }, iaasCtx())).toBe(false)
  })

  it("iaas: connection outside the narrowed scope is denied even if the VMID matches", () => {
    expect(isChangeVisibleToTenant({ ...VM_OWNED, connectionId: "c2" }, iaasCtx())).toBe(false)
  })

  it("iaas: node outside the scope's node whitelist is denied", () => {
    expect(isChangeVisibleToTenant({ ...VM_OWNED, node: "n9" }, iaasCtx())).toBe(false)
  })

  it("iaas: deny-by-default when the scope lists no pool on the connection or the record has none", () => {
    const noPools = { ...iaasCtx().vdcScope!, poolsByConnection: new Map() } as any
    expect(isChangeVisibleToTenant(VM_OWNED, iaasCtx({ vdcScope: noPools }))).toBe(false)
    expect(isChangeVisibleToTenant({ ...VM_OWNED, pool: undefined }, iaasCtx())).toBe(false)
  })
})

describe("isChangeVisibleToTenant on records stamped with the guest's pool", () => {
  it("iaas: the pool the guest sat in decides, not who holds the VMID now", () => {
    // VMID 100 is the tenant's today, but these rows are about the guest of
    // a neighbour's pool that held the ID before
    expect(isChangeVisibleToTenant({ ...VM_OWNED, action: "deleted", pool: "pool-b" }, iaasCtx())).toBe(false)
    expect(isChangeVisibleToTenant({ ...VM_OWNED, pool: "pool-b" }, iaasCtx())).toBe(false)
    // The tenant's own guest, under its pool
    expect(isChangeVisibleToTenant(VM_OWNED, iaasCtx())).toBe(true)
  })

  it("iaas: keeps the history of the tenant's guest once its VMID left the vDC", () => {
    const gone = { ...VM_OWNED, resourceId: "555", action: "deleted", pool: "pool-a" }
    expect(isChangeVisibleToTenant(gone, iaasCtx())).toBe(true)
  })

  it("iaas: a guest in no pool, or a pool on another connection, is denied", () => {
    expect(isChangeVisibleToTenant({ ...VM_OWNED, pool: "" }, iaasCtx())).toBe(false)
    const ctx = iaasCtx({
      vdcScope: { ...iaasCtx().vdcScope!, poolsByConnection: new Map([["c2", new Set(["pool-a"])]]) } as any,
    })
    expect(isChangeVisibleToTenant({ ...VM_OWNED, pool: "pool-a" }, ctx)).toBe(false)
  })

  it("iaas: a record from before the stamp cannot tell its guest's owner and is denied", () => {
    expect(isChangeVisibleToTenant({ ...VM_OWNED, pool: null }, iaasCtx())).toBe(false)
  })

  it("provider and msp ignore the pool, records from before the stamp included", () => {
    const ctx = iaasCtx({ infraKind: "msp", vdcScope: undefined })
    expect(isChangeVisibleToTenant({ ...VM_OWNED, pool: null }, ctx)).toBe(true)
    expect(isChangeVisibleToTenant({ ...VM_OWNED, pool: "pool-z" }, ctx)).toBe(true)
  })
})

describe("isChangeVisibleToTenant with ctx.rbacScope (issue #525)", () => {
  const providerCtx = (rbacScope: ChangeVisibilityCtx["rbacScope"]): ChangeVisibilityCtx => ({
    infraKind: "provider",
    tenantConnectionIds: new Set(["c1", "c2"]),
    vdcScope: null,
    rbacScope,
  })
  const nodeScope = { fullConnections: new Set<string>(), nodesByConnection: new Map([["c1", new Set(["n1"])]]), guestDerived: false }
  const connScope = { fullConnections: new Set(["c1"]), nodesByConnection: new Map<string, Set<string>>(), guestDerived: false }
  const CLUSTER_LESS = { node: "n1", resourceType: "vm", resourceId: "100" }
  const VM_N1 = { connectionId: "c1", node: "n1", resourceType: "vm", resourceId: "100" }
  const CT_N2 = { connectionId: "c1", node: "n2", resourceType: "ct", resourceId: "101" }
  const NODE_N2 = { connectionId: "c1", node: "n2", resourceType: "node", resourceId: "n2" }
  const VM_NO_NODE = { connectionId: "c1", resourceType: "vm", resourceId: "102" }
  const STORAGE = { connectionId: "c1", resourceType: "storage", resourceId: "local-lvm" }
  const POOL = { connectionId: "c1", resourceType: "pool", resourceId: "pool-a" }
  const VM_C2 = { connectionId: "c2", node: "n1", resourceType: "vm", resourceId: "100" }

  it("absent or null scope: the provider verdict is untouched, cluster-less record included", () => {
    expect(isChangeVisibleToTenant(CLUSTER_LESS, providerCtx(undefined))).toBe(true)
    expect(isChangeVisibleToTenant(CLUSTER_LESS, providerCtx(null))).toBe(true)
    expect(isChangeVisibleToTenant(VM_C2, providerCtx(null))).toBe(true)
  })

  it("connection scope: keeps every c1 record, drops c2 and cluster-less records", () => {
    const ctx = providerCtx(connScope)
    expect(isChangeVisibleToTenant(VM_N1, ctx)).toBe(true)
    expect(isChangeVisibleToTenant(CT_N2, ctx)).toBe(true)
    expect(isChangeVisibleToTenant(VM_NO_NODE, ctx)).toBe(true)
    expect(isChangeVisibleToTenant(VM_C2, ctx)).toBe(false)
    expect(isChangeVisibleToTenant(CLUSTER_LESS, ctx)).toBe(false)
  })

  it("node scope: keeps guest and node records on the granted node, drops the other node and unattributed guests", () => {
    const ctx = providerCtx(nodeScope)
    expect(isChangeVisibleToTenant(VM_N1, ctx)).toBe(true)
    expect(isChangeVisibleToTenant(CT_N2, ctx)).toBe(false)
    expect(isChangeVisibleToTenant(NODE_N2, ctx)).toBe(false)
    expect(isChangeVisibleToTenant(VM_NO_NODE, ctx)).toBe(false)
    expect(isChangeVisibleToTenant(VM_C2, ctx)).toBe(false)
  })

  it("node scope: storage and pool records of the granted connection are cluster-level facts and stay", () => {
    const ctx = providerCtx(nodeScope)
    expect(isChangeVisibleToTenant(STORAGE, ctx)).toBe(true)
    expect(isChangeVisibleToTenant(POOL, ctx)).toBe(true)
    expect(isChangeVisibleToTenant({ ...STORAGE, connectionId: "c2" }, ctx)).toBe(false)
  })

  it("guest-derived scope: the tenant-level perimeter is kept, cluster-less records excepted", () => {
    const ctx = providerCtx({ fullConnections: new Set<string>(), nodesByConnection: new Map<string, Set<string>>(), guestDerived: true })
    expect(isChangeVisibleToTenant(CT_N2, ctx)).toBe(true)
    expect(isChangeVisibleToTenant(VM_C2, ctx)).toBe(true)
    expect(isChangeVisibleToTenant(CLUSTER_LESS, ctx)).toBe(false)
  })

  it("RBAC and the vDC mask compose: a record must pass both", () => {
    const ctx = iaasCtx({ rbacScope: connScope })
    expect(isChangeVisibleToTenant(VM_OWNED, ctx)).toBe(true)
    expect(isChangeVisibleToTenant({ ...VM_OWNED, pool: "pool-b" }, ctx)).toBe(false)
    expect(isChangeVisibleToTenant(VM_OWNED, iaasCtx({ rbacScope: nodeScope }))).toBe(true)
    expect(isChangeVisibleToTenant(VM_OWNED, iaasCtx({ rbacScope: { ...connScope, fullConnections: new Set(["c2"]) } }))).toBe(false)
  })

  it("vm scope: only the granted guest's records pass; host and cluster rows are denied", () => {
    const vmScope = {
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["c1", new Set(["n1"])]]),
      nodeGrantsByConnection: new Map<string, Set<string>>(),
      guestGrantsByConnection: new Map([["c1", new Set(["100"])]]),
      guestDerived: false,
    }
    const ctx = providerCtx(vmScope)
    expect(isChangeVisibleToTenant(VM_N1, ctx)).toBe(true)
    expect(isChangeVisibleToTenant({ ...VM_N1, node: "n2" }, ctx)).toBe(true)
    expect(isChangeVisibleToTenant({ ...VM_N1, resourceId: "101" }, ctx)).toBe(false)
    expect(isChangeVisibleToTenant(NODE_N2, ctx)).toBe(false)
    expect(isChangeVisibleToTenant({ connectionId: "c1", node: "n1", resourceType: "node", resourceId: "n1" }, ctx)).toBe(false)
    expect(isChangeVisibleToTenant(STORAGE, ctx)).toBe(false)
  })
})
