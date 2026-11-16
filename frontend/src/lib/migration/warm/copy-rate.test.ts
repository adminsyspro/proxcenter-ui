import { describe, expect, it } from "vitest"

import {
  applyTimeoutMs, copyRateAt, copyRatePayload, copyRateShare, describeCopyRate, isCappedPass, nbdkitRateArg, parseCopyRateLimit,
} from "./copy-rate"

const paris = (from: string, to: string, offHoursMbps = 0) => ({ from, to, tz: "Europe/Paris", offHoursMbps })

describe("parseCopyRateLimit", () => {
  it("accepts a plain cap and 0 (unlimited)", () => {
    expect(parseCopyRateLimit({ mbps: 50 })).toEqual({ mbps: 50 })
    expect(parseCopyRateLimit({ mbps: 0 })).toEqual({ mbps: 0 })
  })

  it("accepts a schedule", () => {
    expect(parseCopyRateLimit({ mbps: 50, schedule: paris("08:00", "19:00") })).toEqual({ mbps: 50, schedule: paris("08:00", "19:00") })
  })

  it("treats an absent value as not set", () => {
    expect(parseCopyRateLimit(undefined)).toBeUndefined()
    expect(parseCopyRateLimit(null)).toBeUndefined()
  })

  it.each([
    ["a fraction", { mbps: 1.5 }],
    ["a negative value", { mbps: -1 }],
    ["a value above the bound", { mbps: 100_001 }],
    ["a string", "50"],
    ["a string mbps", { mbps: "50" }],
    ["an hour out of range", { mbps: 50, schedule: paris("25:00", "07:00") }],
    ["a malformed hour", { mbps: 50, schedule: paris("8:00", "07:00") }],
    ["an unknown time zone", { mbps: 50, schedule: { from: "08:00", to: "19:00", tz: "Mars/Base", offHoursMbps: 0 } }],
    ["an invalid off-hours cap", { mbps: 50, schedule: paris("08:00", "19:00", -3) }],
  ])("rejects %s", (_label, raw) => {
    expect(parseCopyRateLimit(raw)).toBeNull()
  })
})

describe("copyRateAt", () => {
  it("returns the cap at any time without a schedule, 0 when not set", () => {
    expect(copyRateAt({ mbps: 50 }, new Date("2026-11-16T03:00:00Z"))).toBe(50)
    expect(copyRateAt(undefined, new Date())).toBe(0)
    expect(copyRateAt(null, new Date())).toBe(0)
  })

  it("applies the cap inside the window and the off-hours cap outside", () => {
    const limit = { mbps: 50, schedule: paris("08:00", "19:00", 0) }
    expect(copyRateAt(limit, new Date("2026-11-16T09:00:00Z"))).toBe(50) // 10:00 Paris
    expect(copyRateAt(limit, new Date("2026-11-16T19:00:00Z"))).toBe(0) // 20:00 Paris
  })

  it("capAt across midnight in Europe/Paris from a UTC clock", () => {
    const limit = { mbps: 20, schedule: paris("19:00", "07:00", 80) }
    expect(copyRateAt(limit, new Date("2026-11-16T22:00:00Z"))).toBe(20) // 23:00 Paris
    expect(copyRateAt(limit, new Date("2026-11-17T05:59:00Z"))).toBe(20) // 06:59 Paris
    expect(copyRateAt(limit, new Date("2026-11-17T06:00:00Z"))).toBe(80) // 07:00 Paris
    expect(copyRateAt(limit, new Date("2026-11-17T17:59:00Z"))).toBe(80) // 18:59 Paris
  })

  it("applies the cap all day when the window starts and ends at the same time", () => {
    expect(copyRateAt({ mbps: 30, schedule: paris("08:00", "08:00", 0) }, new Date("2026-11-16T01:00:00Z"))).toBe(30)
  })
})

describe("copyRateShare", () => {
  it("splits each cap between its copies and keeps the smallest", () => {
    expect(copyRateShare([{ mbps: 50, copies: 2 }, { mbps: 0, copies: 3 }])).toBe(25)
    expect(copyRateShare([{ mbps: 50, copies: 2 }, { mbps: 30, copies: 1 }])).toBe(25)
    expect(copyRateShare([{ mbps: 50, copies: 2 }, { mbps: 20, copies: 2 }])).toBe(10)
  })

  it("share never drops below 1 MB/s", () => {
    expect(copyRateShare([{ mbps: 2, copies: 5 }])).toBe(1)
  })

  it("is 0 (unlimited) when no cap is set", () => {
    expect(copyRateShare([{ mbps: 0, copies: 1 }])).toBe(0)
    expect(copyRateShare([])).toBe(0)
  })

  it("rounds a share down to a whole MB/s", () => {
    expect(copyRateShare([{ mbps: 50, copies: 3 }])).toBe(16)
  })
})

describe("nbdkit and log helpers", () => {
  it("expresses MB/s as nbdkit bits per second", () => {
    expect(nbdkitRateArg(50)).toBe("400M")
    expect(nbdkitRateArg(1)).toBe("8M")
    expect(nbdkitRateArg(0)).toBe("0")
  })

  it("describes a cap for the job log", () => {
    expect(describeCopyRate(50)).toBe("50 MB/s")
    expect(describeCopyRate(0)).toBe("unlimited")
  })

  it("caps every pass but the final cutover", () => {
    expect(isCappedPass("full_copy")).toBe(true)
    expect(isCappedPass("delta_3")).toBe(true)
    expect(isCappedPass("catch_up")).toBe(true)
    expect(isCappedPass("cutover")).toBe(false)
  })

  it("gives an apply command 12 h plus its bytes at 1 MB/s", () => {
    expect(applyTimeoutMs(0)).toBe(43_200_000)
    expect(applyTimeoutMs(2 * 1024 ** 4)).toBe(43_200_000 + 2_097_152_000)
  })
})

describe("copyRatePayload", () => {
  it("sends the cap of a warm migration only", () => {
    expect(copyRatePayload("warm", { mbps: 40 })).toEqual({ copyRateLimit: { mbps: 40 } })
    expect(copyRatePayload("cold", { mbps: 40 })).toEqual({})
    expect(copyRatePayload("warm", null)).toEqual({})
  })
})
