/**
 * Codex QA-delta review finding 1: the changes routes masked on (node, pool)
 * but orchestrator change records carry NO pool field, so on a shared
 * cluster a neighbour's VM events passed the connection+node checks. The
 * mask is now guest ownership: a vDC tenant only sees "vm"/"ct" records
 * whose VMID resolves inside their vDC pools (deny-by-default).
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
  vdcVmids: new Map([["c1", new Set(["100"])]]),
  ...over,
})

const VM_OWNED = { connectionId: "c1", node: "n1", resourceType: "vm", resourceId: "100" }

describe("isChangeVisibleToTenant", () => {
  it("cluster-less record: provider only", () => {
    const record = { node: "n1", resourceType: "vm", resourceId: "100" }
    expect(isChangeVisibleToTenant(record, iaasCtx({ infraKind: "provider", vdcScope: undefined }))).toBe(true)
    expect(isChangeVisibleToTenant(record, iaasCtx({ infraKind: "msp", vdcScope: undefined }))).toBe(false)
    expect(isChangeVisibleToTenant(record, iaasCtx())).toBe(false)
  })

  it("no vDC scope (provider/msp): connection membership decides, resource type does not", () => {
    const ctx = iaasCtx({ infraKind: "msp", vdcScope: undefined, vdcVmids: undefined })
    expect(isChangeVisibleToTenant({ connectionId: "c1", resourceType: "node", resourceId: "n1" }, ctx)).toBe(true)
    expect(isChangeVisibleToTenant({ connectionId: "c-foreign", resourceType: "vm", resourceId: "100" }, ctx)).toBe(false)
  })

  it("iaas: keeps a guest record whose VMID belongs to the vDC (vm and ct)", () => {
    expect(isChangeVisibleToTenant(VM_OWNED, iaasCtx())).toBe(true)
    expect(isChangeVisibleToTenant({ ...VM_OWNED, resourceType: "ct" }, iaasCtx())).toBe(true)
  })

  it("iaas: drops a neighbour tenant's VM on the same shared connection", () => {
    expect(isChangeVisibleToTenant({ ...VM_OWNED, resourceId: "999" }, iaasCtx())).toBe(false)
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

  it("iaas: deny-by-default when the VMID map has no entry or the record has no resourceId", () => {
    expect(isChangeVisibleToTenant(VM_OWNED, iaasCtx({ vdcVmids: new Map() }))).toBe(false)
    expect(isChangeVisibleToTenant(VM_OWNED, iaasCtx({ vdcVmids: undefined }))).toBe(false)
    expect(isChangeVisibleToTenant({ ...VM_OWNED, resourceId: undefined }, iaasCtx())).toBe(false)
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
    expect(isChangeVisibleToTenant({ ...VM_OWNED, resourceId: "999" }, ctx)).toBe(false)
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
