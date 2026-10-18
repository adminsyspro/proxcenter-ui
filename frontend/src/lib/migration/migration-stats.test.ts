import { describe, expect, it } from "vitest"

import { aggregateMigrationStats, sumMigrationStats, type MigrationStatsRow } from "./migration-stats"

const row = (sourceConnectionId: string, status: string, n: number, bytes: number | bigint | null = null): MigrationStatsRow =>
  ({ sourceConnectionId, status, _count: { _all: n }, _sum: { bytesTransferred: bytes } })

describe("aggregateMigrationStats", () => {
  const types = new Map([["vc", "vmware"], ["esx", "vmware"], ["xcp", "xcpng"]])

  it("counts every status and only the completed migrations' bytes, per source and per type", () => {
    const s = aggregateMigrationStats([
      row("vc", "completed", 40, BigInt(3 * 2 ** 30)),
      row("vc", "failed", 5, 2 ** 20),
      row("vc", "transferring", 2, 2 ** 30),
      row("vc", "queued", 3),
      row("esx", "completed", 1, 2 ** 30),
      row("esx", "cancelled", 1),
      row("xcp", "delta_sync", 1, 7),
    ], types)
    expect(s.bySource.vc).toEqual({ completed: 40, failed: 5, cancelled: 0, queued: 3, inProgress: 2, bytesTransferred: 3 * 2 ** 30 })
    expect(s.byType.vmware).toEqual({ completed: 41, failed: 5, cancelled: 1, queued: 3, inProgress: 2, bytesTransferred: 4 * 2 ** 30 })
    expect(s.byType.xcpng).toEqual({ completed: 0, failed: 0, cancelled: 0, queued: 0, inProgress: 1, bytesTransferred: 0 })
  })

  it("drops the rows of a source the caller does not see", () => {
    const s = aggregateMigrationStats([row("other-tenant", "completed", 9, 99)], types)
    expect(s).toEqual({ bySource: {}, byType: {} })
  })
})

describe("sumMigrationStats", () => {
  it("adds up the sources of a hypervisor-type page and ignores unknown ones", () => {
    const { bySource } = aggregateMigrationStats([row("vc", "completed", 2, 10), row("esx", "completed", 1, 5), row("esx", "failed", 1)], new Map([["vc", "vmware"], ["esx", "vmware"]]))
    expect(sumMigrationStats(bySource, ["vc", "esx", "gone"])).toMatchObject({ completed: 3, failed: 1, bytesTransferred: 15 })
    expect(sumMigrationStats(undefined, ["vc"]).completed).toBe(0)
  })
})
