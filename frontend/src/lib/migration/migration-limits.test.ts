import { describe, expect, it } from "vitest"

import {
  MIGRATION_LIMIT_MAX, MIGRATION_PARALLEL_DEFAULT, MIGRATION_PER_NODE_DEFAULT, MIGRATION_PER_SOURCE_HOST_DEFAULT,
  effectiveMigrationLimits, migrationLimitFields, pickJobsToStart, sourceHostKey,
} from "./migration-limits"

const limits = { batch: 5, cluster: 5, perNode: 2, perSourceHost: 4 }
const job = (id: string, targetNode = "pve1", host: string | null = "src|esx1") => ({ id, targetNode, sourceHostKey: host })

describe("effectiveMigrationLimits", () => {
  it("uses the defaults when the connections set nothing", () => {
    expect(effectiveMigrationLimits({}, { type: "vmware" })).toEqual({
      cluster: MIGRATION_PARALLEL_DEFAULT, perNode: MIGRATION_PER_NODE_DEFAULT, perSourceHost: MIGRATION_PER_SOURCE_HOST_DEFAULT,
    })
    expect(MIGRATION_PARALLEL_DEFAULT).toBe(5)
    expect(MIGRATION_PER_NODE_DEFAULT).toBe(2)
    expect(MIGRATION_PER_SOURCE_HOST_DEFAULT).toBe(4)
  })

  it("takes the values set on the target and source connections, clamped to 1..MAX", () => {
    expect(effectiveMigrationLimits(
      { migrationMaxParallel: 12, migrationMaxPerNode: 3 },
      { type: "vmware", migrationMaxPerSourceHost: 6 },
    )).toEqual({ cluster: 12, perNode: 3, perSourceHost: 6 })
    expect(effectiveMigrationLimits({ migrationMaxParallel: 99, migrationMaxPerNode: 0 }, {}).cluster).toBe(MIGRATION_LIMIT_MAX)
    expect(effectiveMigrationLimits({ migrationMaxPerNode: 0 }, {}).perNode).toBe(MIGRATION_PER_NODE_DEFAULT)
  })

  it("never lets the per-node limit exceed the cluster limit", () => {
    expect(effectiveMigrationLimits({ migrationMaxParallel: 3, migrationMaxPerNode: 8 }, {}).perNode).toBe(3)
  })

  it("puts no per-host limit on a source that is not VMware", () => {
    expect(effectiveMigrationLimits({}, { type: "xcpng", migrationMaxPerSourceHost: 2 }).perSourceHost).toBe(Infinity)
  })
})

describe("sourceHostKey", () => {
  it("names the ESXi host of a vCenter source, the connection itself for a direct ESXi", () => {
    expect(sourceHostKey("vc", { vcenterHost: "10.42.0.21" })).toBe("vc|10.42.0.21")
    expect(sourceHostKey("esx", {})).toBe("esx|")
    expect(sourceHostKey("vc", null)).toBe("vc|")
  })
})

describe("pickJobsToStart", () => {
  it("starts queued jobs in order up to the batch slots", () => {
    const picked = pickJobsToStart({
      queued: [job("a", "pve1"), job("b", "pve2"), job("c", "pve3")],
      running: [], batchRunning: 0, limits: { ...limits, batch: 2 },
    })
    expect(picked).toEqual(["a", "b"])
  })

  it("holds a job whose target node is full and starts the next one on another node", () => {
    const picked = pickJobsToStart({
      queued: [job("a", "pve1"), job("b", "pve1"), job("c", "pve1"), job("d", "pve2")],
      running: [], batchRunning: 0, limits,
    })
    expect(picked).toEqual(["a", "b", "d"])
  })

  it("counts the migrations already running on the node, whatever started them", () => {
    const picked = pickJobsToStart({
      queued: [job("a", "pve1"), job("b", "pve2")],
      running: [{ targetNode: "pve1", sourceHostKey: null, sameTarget: true }],
      batchRunning: 0, limits: { ...limits, perNode: 1 },
    })
    expect(picked).toEqual(["b"])
  })

  it("stops at the cluster limit, counting the other batches and single migrations", () => {
    const running = Array.from({ length: 4 }, (_, i) => ({ targetNode: `n${i}`, sourceHostKey: null, sameTarget: true }))
    const picked = pickJobsToStart({
      queued: [job("a", "pve1"), job("b", "pve2")],
      running, batchRunning: 0, limits,
    })
    expect(picked).toEqual(["a"])
  })

  it("holds a job whose source host already feeds its limit, even towards another cluster", () => {
    const picked = pickJobsToStart({
      queued: [job("a", "pve1", "src|esx1"), job("b", "pve2", "src|esx2")],
      running: [{ targetNode: "other", sourceHostKey: "src|esx1", sameTarget: false }],
      batchRunning: 0, limits: { ...limits, perSourceHost: 1 },
    })
    expect(picked).toEqual(["b"])
  })

  it("does not count a migration towards another cluster against this cluster or its nodes", () => {
    const picked = pickJobsToStart({
      queued: [job("a", "pve1")],
      running: [{ targetNode: "pve1", sourceHostKey: null, sameTarget: false }],
      batchRunning: 0, limits: { ...limits, cluster: 1, perNode: 1 },
    })
    expect(picked).toEqual(["a"])
  })

  it("subtracts the jobs of the batch that are already running from its slots", () => {
    const picked = pickJobsToStart({
      queued: [job("a", "pve2"), job("b", "pve3")],
      running: [{ targetNode: "pve1", sourceHostKey: null, sameTarget: true }],
      batchRunning: 1, limits: { ...limits, batch: 2 },
    })
    expect(picked).toEqual(["a"])
  })

  it("never starts more than the cluster limit even when the batch asks for more", () => {
    const queued = Array.from({ length: 10 }, (_, i) => job(`j${i}`, `pve${i}`, `h${i}`))
    expect(pickJobsToStart({ queued, running: [], batchRunning: 0, limits: { ...limits, batch: 10, cluster: 3 } })).toHaveLength(3)
  })
})

describe("migrationLimitFields", () => {
  const body = { migrationMaxParallel: 10, migrationMaxPerNode: 3, migrationMaxPerSourceHost: 6, name: "x" }

  it("keeps the cluster and per-node limits on a PVE connection", () => {
    expect(migrationLimitFields("pve", body)).toEqual({ migrationMaxParallel: 10, migrationMaxPerNode: 3 })
  })

  it("keeps the per-host limit on a VMware connection", () => {
    expect(migrationLimitFields("vmware", body)).toEqual({ migrationMaxPerSourceHost: 6 })
  })

  it("passes null through (back to the default) and drops what was not sent", () => {
    expect(migrationLimitFields("pve", { migrationMaxParallel: null })).toEqual({ migrationMaxParallel: null })
    expect(migrationLimitFields("pbs", body)).toEqual({})
  })
})
