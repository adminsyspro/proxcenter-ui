import { describe, it, expect } from "vitest"
import { parseSpeedMBps, etaSeconds, formatEta, stepLabelKey } from "./taskProgressDisplay"

describe("parseSpeedMBps", () => {
  it("parses the bare pipeline form", () => {
    expect(parseSpeedMBps("64 MB/s")).toBe(64)
  })
  it("parses prefixed forms (thick pre-zero)", () => {
    expect(parseSpeedMBps("Zeroing: 80 MB/s")).toBe(80)
  })
  it("parses decimals and the MiB/s spelling", () => {
    expect(parseSpeedMBps("12.5 MB/s")).toBe(12.5)
    expect(parseSpeedMBps("100 MiB/s")).toBe(100)
  })
  it("returns null when absent", () => {
    expect(parseSpeedMBps(null)).toBeNull()
    expect(parseSpeedMBps("")).toBeNull()
  })
  it("returns null when unparseable", () => {
    expect(parseSpeedMBps("fast")).toBeNull()
    expect(parseSpeedMBps("64 GB/s")).toBeNull()
  })
})

describe("etaSeconds", () => {
  const MB = 1048576
  it("computes remaining seconds from the byte gap and the MB/s speed", () => {
    // 32 MiB to go at 2 MB/s -> 16 s
    expect(etaSeconds(32 * MB, 64 * MB, 2)).toBe(16)
  })
  it("returns null on any missing input", () => {
    expect(etaSeconds(null, 64 * MB, 2)).toBeNull()
    expect(etaSeconds(32 * MB, null, 2)).toBeNull()
    expect(etaSeconds(32 * MB, 64 * MB, null)).toBeNull()
  })
  it("returns null on zero or negative inputs", () => {
    expect(etaSeconds(0, 0, 2)).toBeNull()
    expect(etaSeconds(0, -1, 2)).toBeNull()
    expect(etaSeconds(-1, 64 * MB, 2)).toBeNull()
    expect(etaSeconds(0, 64 * MB, 0)).toBeNull()
    expect(etaSeconds(0, 64 * MB, -3)).toBeNull()
  })
  it("returns null once the transfer caught up (transferred >= total)", () => {
    expect(etaSeconds(64 * MB, 64 * MB, 2)).toBeNull()
    expect(etaSeconds(65 * MB, 64 * MB, 2)).toBeNull()
  })
})

describe("formatEta", () => {
  it("renders sub-minute in seconds", () => {
    expect(formatEta(45)).toBe("45s")
    expect(formatEta(0)).toBe("0s")
  })
  it("clamps negatives to zero", () => {
    expect(formatEta(-5)).toBe("0s")
  })
  it("renders sub-hour in whole minutes", () => {
    expect(formatEta(720)).toBe("12m")
    expect(formatEta(90)).toBe("1m")
  })
  it("renders hours with a minute remainder", () => {
    expect(formatEta(3 * 3600 + 12 * 60)).toBe("3h 12m")
  })
  it("drops a zero minute remainder", () => {
    expect(formatEta(7200)).toBe("2h")
  })
})

describe("stepLabelKey", () => {
  it("maps every known pipeline step to itself", () => {
    for (const step of [
      "planning", "enabling_cbt", "preparing_disks", "full_copy", "source_shutdown",
      "awaiting_cutover", "cutover", "verify", "converting_disks",
      "preflight", "transferring", "creating_vm", "configuring", "pending",
    ]) {
      expect(stepLabelKey(step)).toBe(step)
    }
  })
  it("collapses numbered delta passes to 'delta'", () => {
    expect(stepLabelKey("delta_1")).toBe("delta")
    expect(stepLabelKey("delta_12")).toBe("delta")
  })
  it("returns null for unknown steps so the raw string can be shown", () => {
    expect(stepLabelKey("delta_")).toBeNull()
    expect(stepLabelKey("importing_disk_2")).toBeNull()
    expect(stepLabelKey("Copying disk 1/2")).toBeNull()
  })
  it("returns null when there is no step", () => {
    expect(stepLabelKey(null)).toBeNull()
    expect(stepLabelKey("")).toBeNull()
  })
})
