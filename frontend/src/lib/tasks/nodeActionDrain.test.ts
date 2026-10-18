import { describe, expect, it } from "vitest"

import {
  isNodeActionDrainOver,
  nodeActionDrainConfig,
  nodeActionDrainProgress,
  nodeActionDrainReason,
  nodeActionDrainRemaining,
} from "./nodeActionDrain"

const drain = (over: Record<string, any> = {}) => ({
  id: "d-1",
  status: "partial",
  node: "pve3",
  total_guests: 4,
  completed_guests: 2,
  failed_guests: 1,
  skipped_guests: 1,
  guests: [
    { vmid: 1, name: "a", status: "completed" },
    { vmid: 2, name: "b", status: "completed" },
    { vmid: 3, name: "c", status: "failed", error: "task failed: boom", failure_reason: "boom" },
    { vmid: 4, name: "d", status: "skipped", kept: true, reason: "stopped guest left in place" },
  ],
  ...over,
})

describe("nodeActionDrainConfig", () => {
  it("keeps stopped guests, enters maintenance on a cluster node, honours a manual target", () => {
    expect(nodeActionDrainConfig({ cluster: true })).toEqual({ target_node: "", max_concurrent_migrations: 2, include_stopped: false, enter_maintenance: true })
    expect(nodeActionDrainConfig({ cluster: false, targetNode: "pve1", maxParallel: 3 })).toEqual({ target_node: "pve1", max_concurrent_migrations: 3, include_stopped: false, enter_maintenance: false })
  })
})

describe("drain outcome", () => {
  it("knows when the drain is over", () => {
    expect(isNodeActionDrainOver("running")).toBe(false)
    expect(isNodeActionDrainOver("pending")).toBe(false)
    for (const s of ["completed", "partial", "failed", "cancelled"]) expect(isNodeActionDrainOver(s)).toBe(true)
    expect(isNodeActionDrainOver(undefined)).toBe(false)
  })

  it("lists the guests still in the way, not the ones kept on purpose", () => {
    expect(nodeActionDrainRemaining(drain()).map(g => g.vmid)).toEqual([3])
    expect(nodeActionDrainRemaining(null)).toEqual([])
  })

  it("reports progress from the settled guests and the reason of a leftover", () => {
    expect(nodeActionDrainProgress(drain())).toEqual({ done: 4, total: 4 })
    expect(nodeActionDrainProgress(drain({ completed_guests: 1, failed_guests: 0, skipped_guests: 0 }))).toEqual({ done: 1, total: 4 })
    expect(nodeActionDrainReason(drain().guests[2])).toBe("boom")
    expect(nodeActionDrainReason({ vmid: 9, reason: "locked" })).toBe("locked")
  })
})
