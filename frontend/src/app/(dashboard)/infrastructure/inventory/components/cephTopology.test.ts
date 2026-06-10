import { describe, it, expect } from "vitest"
import { buildCrushTopology, capacityColor } from "./cephTopology"

// Mirrors real PVE shapes: OSD ids are STRINGS, the /ceph/rules endpoint is
// bare ({name} only, no id/steps), the pool carries crush_rule_name +
// autoscale crush_root_id, and the route's osds.list usedBytes is unreliable
// (0 here) while usedPct/totalBytes are trustworthy.
const cephData = {
  crushTree: [
    { id: -1, name: "default", type: "root", children: [
      { id: -3, name: "rack-A", type: "rack", children: [
        { id: -2, name: "pve1", type: "host", children: [
          { id: "0", name: "osd.0", type: "osd", status: "up" },
          { id: "1", name: "osd.1", type: "osd", status: "up" },
        ]},
      ]},
    ]},
  ],
  osds: { list: [
    { id: "0", name: "osd.0", host: "pve1", up: true, in: true, deviceClass: "hdd", totalBytes: 100, usedBytes: 0, usedPct: 80 },
    { id: "1", name: "osd.1", host: "pve1", up: true, in: true, deviceClass: "hdd", totalBytes: 100, usedBytes: 0, usedPct: 40 },
  ]},
  monitors: { list: [{ name: "pve1", host: "pve1", inQuorum: true, leader: true }] },
  managers: { active: { name: "pve1", host: "pve1" }, standbys: [] },
  mds: { list: [{ name: "mds.pve1", host: "pve1", state: "active" }] },
  pools: { list: [
    { id: "1", name: "rbd", size: 3, minSize: 2, crushRule: "0", crushRuleName: "replicated_rule", crushRootId: -1, percentUsed: 0.0699853897 },
  ]},
  crushRules: [{ name: "replicated_rule" }],
}

describe("buildCrushTopology", () => {
  it("merges osd status/class into the leaf nodes despite STRING ids", () => {
    const { tree } = buildCrushTopology(cephData as any)
    const osd0 = tree[0].children![0].children![0].children![0]
    expect(osd0.usedPct).toBe(80)
    expect(osd0.osd).toEqual({ up: true, in: true, deviceClass: "hdd" })
  })

  it("derives usedBytes from usedPct (route usedBytes is unreliable) and rolls capacity up", () => {
    const { tree } = buildCrushTopology(cephData as any)
    const host = tree[0].children![0].children![0]
    expect(host.totalBytes).toBe(200)
    expect(host.usedBytes).toBe(120) // 100*80% + 100*40% — NOT the 0 from osds.list
    expect(host.usedPct).toBe(60)
    expect(tree[0].usedPct).toBe(60) // root aggregates the same
  })

  it("attaches mon (with leader), mgr and mds badges to the host node", () => {
    const { tree } = buildCrushTopology(cephData as any)
    const host = tree[0].children![0].children![0]
    expect(host.daemons).toEqual({ mon: true, monLeader: true, mgr: true, mds: true })
  })

  it("names the rule from crush_rule_name, resolves target from crush root id, rounds %used", () => {
    const { poolRules } = buildCrushTopology(cephData as any)
    expect(poolRules).toEqual([
      { pool: "rbd", ruleName: "replicated_rule", target: "default", size: "3/2", usedPct: 0.1 },
    ])
  })

  it("uses the rule take-step target when the rules endpoint provides steps", () => {
    const { poolRules } = buildCrushTopology({
      pools: { list: [{ name: "p", size: 3, minSize: 2, crushRule: "5", percentUsed: 0 }] },
      crushRules: [{ id: 5, name: "ssd_rule", steps: [{ op: "take", item_name: "default~ssd" }] }],
    } as any)
    expect(poolRules[0]).toEqual({ pool: "p", ruleName: "ssd_rule", target: "default~ssd", size: "3/2", usedPct: 0 })
  })

  it("returns empty tree/poolRules for missing data without throwing", () => {
    const { tree, poolRules } = buildCrushTopology({} as any)
    expect(tree).toEqual([])
    expect(poolRules).toEqual([])
  })
})

describe("capacityColor", () => {
  it("maps utilization to theme palette keys", () => {
    expect(capacityColor(10)).toBe("success")
    expect(capacityColor(75)).toBe("warning")
    expect(capacityColor(90)).toBe("error")
  })
})
