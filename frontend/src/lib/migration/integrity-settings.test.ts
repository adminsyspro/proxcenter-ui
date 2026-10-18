import { describe, it, expect } from "vitest"
import { planSampleRegions, describeSamplePlan, formatBytesShort, MIB, DEFAULT_INTEGRITY_SETTINGS, integritySettingsFromConnection, estimateIntegritySecondsPerDisk } from "./integrity-settings"

const GIB = 1024 * MIB

describe("planSampleRegions", () => {
  it("samples the first, the last and N spread regions, MiB aligned and in order", () => {
    const regions = planSampleRegions(3 * GIB, { regionCount: 8, regionSizeMiB: 4 })
    expect(regions).toHaveLength(10)
    expect(regions[0]).toEqual({ index: 0, offset: 0, length: 4 * MIB, kind: "first" })
    expect(regions.at(-1)).toEqual({ index: 9, offset: 3 * GIB - 4 * MIB, length: 4 * MIB, kind: "last" })
    expect(regions.filter(r => r.kind === "spread")).toHaveLength(8)
    for (const r of regions) {
      expect(r.offset % MIB).toBe(0)
      expect(r.length).toBe(4 * MIB)
    }
    for (let i = 1; i < regions.length; i++) expect(regions[i].offset).toBeGreaterThanOrEqual(regions[i - 1].offset + regions[i - 1].length)
    expect(regions.map(r => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it("spreads evenly: on 3 GiB with 2 regions the spread offsets sit at a third and two thirds", () => {
    const regions = planSampleRegions(3 * GIB, { regionCount: 2, regionSizeMiB: 4 })
    expect(regions.map(r => r.offset / MIB)).toEqual([0, 1024, 2048, 3068])
  })

  it("honours the region size and a zero spread count", () => {
    const regions = planSampleRegions(10 * GIB, { regionCount: 0, regionSizeMiB: 16 })
    expect(regions.map(r => [r.kind, r.offset / MIB, r.length / MIB])).toEqual([["first", 0, 16], ["last", 10 * 1024 - 16, 16]])
  })

  it("collapses to one region on a disk too small for two, and keeps a sub-MiB disk readable", () => {
    expect(planSampleRegions(6 * MIB, { regionCount: 8, regionSizeMiB: 4 })).toEqual([{ index: 0, offset: 0, length: 4 * MIB, kind: "first" }])
    expect(planSampleRegions(3 * MIB, { regionCount: 8, regionSizeMiB: 4 })).toEqual([{ index: 0, offset: 0, length: 3 * MIB, kind: "first" }])
    expect(planSampleRegions(700_000, { regionCount: 8, regionSizeMiB: 4 })).toEqual([{ index: 0, offset: 0, length: 700_000, kind: "first" }])
    expect(planSampleRegions(0, DEFAULT_INTEGRITY_SETTINGS)).toEqual([])
    expect(planSampleRegions(Number.NaN, DEFAULT_INTEGRITY_SETTINGS)).toEqual([])
  })

  it("never overlaps regions when the count is high for the disk size", () => {
    const regions = planSampleRegions(64 * MIB, { regionCount: 64, regionSizeMiB: 4 })
    for (let i = 1; i < regions.length; i++) expect(regions[i].offset).toBeGreaterThanOrEqual(regions[i - 1].offset + regions[i - 1].length)
    expect(regions[0].kind).toBe("first")
    expect(regions.at(-1)?.kind).toBe("last")
  })

  it("ignores a tail shorter than one MiB", () => {
    const regions = planSampleRegions(2 * GIB + 1000, { regionCount: 1, regionSizeMiB: 4 })
    expect(regions.at(-1)?.offset).toBe(2 * GIB - 4 * MIB)
  })
})

describe("log wording", () => {
  it("formats offsets and sizes compactly", () => {
    expect(formatBytesShort(0)).toBe("0")
    expect(formatBytesShort(4 * MIB)).toBe("4 MiB")
    expect(formatBytesShort(3 * GIB - 4 * MIB)).toBe("3068 MiB")
    expect(formatBytesShort(12 * GIB)).toBe("12.0 GiB")
    expect(formatBytesShort(1.5 * MIB)).toBe("1.5 MiB")
  })

  it("describes the plan in one line", () => {
    expect(describeSamplePlan(planSampleRegions(3 * GIB, { regionCount: 2, regionSizeMiB: 4 })))
      .toBe("4 regions of 4 MiB: first, last and 2 spread (offsets 1024 MiB, 2048 MiB)")
    expect(describeSamplePlan(planSampleRegions(3 * GIB, { regionCount: 0, regionSizeMiB: 4 }))).toBe("2 regions of 4 MiB: first, last")
    expect(describeSamplePlan(planSampleRegions(4 * MIB, { regionCount: 8, regionSizeMiB: 4 }))).toBe("1 region of 4 MiB at offset 0")
    expect(describeSamplePlan([])).toBe("no region (empty disk)")
    expect(describeSamplePlan(planSampleRegions(30 * GIB, { regionCount: 8, regionSizeMiB: 4 }))).toContain("...")
  })
})

describe("integritySettingsFromConnection", () => {
  it("takes the defaults for a connection that sets nothing, or bad values", () => {
    expect(integritySettingsFromConnection(null)).toEqual(DEFAULT_INTEGRITY_SETTINGS)
    expect(integritySettingsFromConnection({ integrityCheckEnabled: null, integrityRegionCount: 999, integrityRegionSizeMiB: 0 })).toEqual(DEFAULT_INTEGRITY_SETTINGS)
  })
  it("keeps what the connection sets, the check turned off included", () => {
    expect(integritySettingsFromConnection({ integrityCheckEnabled: false, integrityRegionCount: 2, integrityRegionSizeMiB: 16 })).toEqual({ enabled: false, regionCount: 2, regionSizeMiB: 16 })
  })
})

describe("estimateIntegritySecondsPerDisk", () => {
  it("is about 1.5 s for the defaults, scales with what is hashed, 0 when off", () => {
    expect(estimateIntegritySecondsPerDisk(DEFAULT_INTEGRITY_SETTINGS)).toBe(2)
    expect(estimateIntegritySecondsPerDisk({ enabled: true, regionCount: 0, regionSizeMiB: 1 })).toBe(1)
    expect(estimateIntegritySecondsPerDisk({ enabled: true, regionCount: 64, regionSizeMiB: 64 })).toBe(158)
    expect(estimateIntegritySecondsPerDisk({ ...DEFAULT_INTEGRITY_SETTINGS, enabled: false })).toBe(0)
  })
})
