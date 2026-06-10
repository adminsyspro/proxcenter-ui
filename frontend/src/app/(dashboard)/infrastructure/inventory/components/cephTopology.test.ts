import { describe, it, expect } from "vitest"
import { buildCrushTopology, capacityColor } from "./cephTopology"

const cephData = {
  crushTree: [
    { id: -1, name: "default", type: "root", children: [
      { id: -3, name: "rack-A", type: "rack", children: [
        { id: -2, name: "pve1", type: "host", children: [
          { id: 0, name: "osd.0", type: "osd", status: "up" },
          { id: 1, name: "osd.1", type: "osd", status: "up" },
        ]},
      ]},
    ]},
  ],
  osds: { list: [
    { id: 0, name: "osd.0", host: "pve1", up: true, in: true, deviceClass: "nvme", totalBytes: 100, usedBytes: 80, usedPct: 80 },
    { id: 1, name: "osd.1", host: "pve1", up: true, in: true, deviceClass: "nvme", totalBytes: 100, usedBytes: 40, usedPct: 40 },
  ]},
  monitors: { list: [{ name: "pve1", host: "pve1", inQuorum: true, leader: true }] },
  managers: { active: { name: "pve1", host: "pve1" }, standbys: [] },
  mds: { list: [{ name: "mds.pve1", host: "pve1", state: "active" }] },
  pools: { list: [{ id: 1, name: "rbd", size: 3, minSize: 2, crushRule: 0, percentUsed: 41 }] },
  crushRules: [{ id: 0, name: "replicated_rule", steps: [{ op: "take", item_name: "default" }, { op: "choose_firstn" }] }],
}

describe("buildCrushTopology", () => {
  it("merges osd capacity/status into the crush leaf nodes", () => {
    const { tree } = buildCrushTopology(cephData as any)
    const osd0 = tree[0].children![0].children![0].children![0]
    expect(osd0.usedPct).toBe(80)
    expect(osd0.osd).toEqual({ up: true, in: true, deviceClass: "nvme" })
  })

  it("aggregates capacity bottom-up for host/rack/root", () => {
    const { tree } = buildCrushTopology(cephData as any)
    const host = tree[0].children![0].children![0]
    expect(host.totalBytes).toBe(200)
    expect(host.usedBytes).toBe(120)
    expect(host.usedPct).toBe(60)
    expect(tree[0].usedPct).toBe(60) // root aggregates the same
  })

  it("attaches mon (with leader), mgr and mds badges to the host node", () => {
    const { tree } = buildCrushTopology(cephData as any)
    const host = tree[0].children![0].children![0]
    expect(host.daemons).toEqual({ mon: true, monLeader: true, mgr: true, mds: true })
  })

  it("maps pools to their crush rule name and take-step target", () => {
    const { poolRules } = buildCrushTopology(cephData as any)
    expect(poolRules).toEqual([
      { pool: "rbd", ruleName: "replicated_rule", target: "default", size: "3/2", usedPct: 41 },
    ])
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
