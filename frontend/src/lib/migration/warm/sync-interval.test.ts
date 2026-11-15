import { describe, expect, it } from "vitest"

import {
  SYNC_INTERVAL_DEFAULT_SEC, SYNC_INTERVAL_MAX_SEC, SYNC_INTERVAL_MIN_SEC, SYNC_INTERVAL_STEPS_SEC,
  estimateCutover, formatSyncInterval, parseCutoverMeasure, parseSyncInterval, suggestSyncIntervalSec, syncIntervalStepIndex,
} from "./sync-interval"

describe("parseSyncInterval", () => {
  it("bounds the interval between one minute and one day, one minute by default", () => {
    expect(SYNC_INTERVAL_MIN_SEC).toBe(60)
    expect(SYNC_INTERVAL_MAX_SEC).toBe(86400)
    expect(SYNC_INTERVAL_DEFAULT_SEC).toBe(60)
  })

  it("reads an absent value as not set", () => {
    expect(parseSyncInterval(undefined)).toBeUndefined()
    expect(parseSyncInterval(null)).toBeUndefined()
    expect(parseSyncInterval("")).toBeUndefined()
  })

  it("accepts a whole number of seconds inside the bounds, as a number or a string", () => {
    expect(parseSyncInterval(60)).toBe(60)
    expect(parseSyncInterval("3600")).toBe(3600)
    expect(parseSyncInterval(86400)).toBe(86400)
  })

  it("refuses a value outside the bounds, a fraction or text", () => {
    expect(parseSyncInterval(59)).toBeNull()
    expect(parseSyncInterval(86401)).toBeNull()
    expect(parseSyncInterval(90.5)).toBeNull()
    expect(parseSyncInterval("abc")).toBeNull()
  })
})

describe("sync interval steps of the sliders", () => {
  it("offers twelve steps from one minute to one day", () => {
    expect(SYNC_INTERVAL_STEPS_SEC).toEqual([60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400])
  })

  it("places a stored value on its step, or on the nearest one", () => {
    expect(syncIntervalStepIndex(60)).toBe(0)
    expect(syncIntervalStepIndex(900)).toBe(4)
    expect(syncIntervalStepIndex(1000)).toBe(4)
    expect(syncIntervalStepIndex(86400)).toBe(11)
  })

  it("places a missing value on the default step", () => {
    expect(syncIntervalStepIndex(null)).toBe(0)
    expect(syncIntervalStepIndex(undefined)).toBe(0)
  })

  it("writes minutes under an hour and whole hours above", () => {
    expect(formatSyncInterval(60)).toBe("1 min")
    expect(formatSyncInterval(1800)).toBe("30 min")
    expect(formatSyncInterval(3600)).toBe("1 h")
    expect(formatSyncInterval(86400)).toBe("24 h")
    expect(formatSyncInterval(5400)).toBe("90 min")
  })
})

describe("suggestSyncIntervalSec", () => {
  const MB = 1048576
  const base = { passSec: 8, changeRateBytesPerSec: (100 * MB) / 300, observedWindowSec: 300, throughputBytesPerSec: 50 * MB, budgetSec: 300, fixedDowntimeSec: 50 }

  it("lengthens a quiet VM step by step, never beyond four times what was observed", () => {
    expect(suggestSyncIntervalSec(base)).toBe(900)
    expect(suggestSyncIntervalSec({ ...base, observedWindowSec: 3600 })).toBe(14400)
  })

  it("keeps a busy VM on short syncs so the last delta fits half the downtime budget", () => {
    expect(suggestSyncIntervalSec({ ...base, changeRateBytesPerSec: (20480 * MB) / 300 })).toBe(60)
    // 250 s of transfer at 50 MB/s is 12 500 MB; at 5 MB/s of changes that is 2 500 s, halved: 1 250 s.
    expect(suggestSyncIntervalSec({ ...base, changeRateBytesPerSec: 5 * MB, observedWindowSec: 3600 })).toBe(900)
  })

  it("gives a slow source at least four times the length of a sync to rest, even on a busy VM", () => {
    expect(suggestSyncIntervalSec({ ...base, passSec: 600, changeRateBytesPerSec: (20480 * MB) / 300 })).toBe(3600)
    expect(suggestSyncIntervalSec({ ...base, passSec: 50000 })).toBe(86400)
  })

  it("reads an idle VM or an unknown copy rate as no limit from the budget", () => {
    expect(suggestSyncIntervalSec({ ...base, changeRateBytesPerSec: 0 })).toBe(900)
    expect(suggestSyncIntervalSec({ ...base, throughputBytesPerSec: 0 })).toBe(900)
  })

  it("stays on the shortest sync when the budget is below what every cutover costs", () => {
    expect(suggestSyncIntervalSec({ ...base, budgetSec: 30 })).toBe(60)
  })
})

describe("estimateCutover", () => {
  const MB = 1048576
  const measure = { changeRateBytesPerSec: 1 * MB, throughputBytesPerSec: 50 * MB, passOverheadSec: 10, fixedDowntimeSec: 50 }

  it("grows the catch-up sync with the interval, and the downtime only with what changes during that sync", () => {
    // 1 h of changes at 1 MB/s is 3 600 MB, 72 s of copy at 50 MB/s, plus 10 s of snapshot handling.
    expect(estimateCutover(measure, 3600)).toEqual({ catchUpSec: 82, downtimeSec: 52 })
    expect(estimateCutover(measure, 60)).toEqual({ catchUpSec: 11, downtimeSec: 50 })
    expect(estimateCutover(measure, 86400)).toEqual({ catchUpSec: 1738, downtimeSec: 85 })
  })

  it("is the fixed cost alone for an idle VM or an unknown copy rate", () => {
    expect(estimateCutover({ ...measure, changeRateBytesPerSec: 0 }, 86400)).toEqual({ catchUpSec: 10, downtimeSec: 50 })
    expect(estimateCutover({ ...measure, throughputBytesPerSec: 0 }, 3600)).toEqual({ catchUpSec: 10, downtimeSec: 50 })
  })

  it("stays finite for a VM that writes as fast as the copy goes", () => {
    const est = estimateCutover({ ...measure, changeRateBytesPerSec: 80 * MB }, 3600)
    expect(Number.isFinite(est.catchUpSec) && Number.isFinite(est.downtimeSec)).toBe(true)
    expect(est.downtimeSec).toBeGreaterThan(3000)
  })
})

describe("parseCutoverMeasure", () => {
  it("reads a stored measure and refuses anything else", () => {
    const m = { changeRateBytesPerSec: 1, throughputBytesPerSec: 2, passOverheadSec: 3, fixedDowntimeSec: 4 }
    expect(parseCutoverMeasure({ ...m, extra: true })).toEqual(m)
    expect(parseCutoverMeasure(null)).toBeNull()
    expect(parseCutoverMeasure({ ...m, throughputBytesPerSec: "fast" })).toBeNull()
    expect(parseCutoverMeasure({ ...m, passOverheadSec: -1 })).toBeNull()
  })

  it("keeps the downtime the migration aims at when the measure carries one", () => {
    const m = { changeRateBytesPerSec: 1, throughputBytesPerSec: 2, passOverheadSec: 3, fixedDowntimeSec: 4 }
    expect(parseCutoverMeasure({ ...m, targetDowntimeSec: 300 })).toEqual({ ...m, targetDowntimeSec: 300 })
    // a measure stored before the target existed, or a broken one, still reads
    expect(parseCutoverMeasure({ ...m, targetDowntimeSec: "soon" })).toEqual(m)
    expect(parseCutoverMeasure({ ...m, targetDowntimeSec: 0 })).toEqual(m)
  })
})
