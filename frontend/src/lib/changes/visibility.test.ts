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
