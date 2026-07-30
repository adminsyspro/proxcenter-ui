import { describe, it, expect } from "vitest"
import { parseDdProgress, createDdProgressAccumulator } from "./dd-progress"

describe("parseDdProgress", () => {
  it("parses a single dd progress line into bytes, seconds and derived rate", () => {
    const r = parseDdProgress("1073741824 bytes (1.1 GB, 1.0 GiB) copied, 10 s, 107 MB/s")
    expect(r).not.toBeNull()
    expect(r!.bytes).toBe(1073741824)
    expect(r!.seconds).toBe(10)
    expect(r!.bytesPerSec).toBeCloseTo(107374182.4, 0)
  })

  it("returns the LAST progress figure when a chunk carries several (dd overwrites via \\r)", () => {
    const chunk =
      "104857600 bytes (105 MB, 100 MiB) copied, 1 s, 105 MB/s\r" +
      "524288000 bytes (524 MB, 500 MiB) copied, 5 s, 105 MB/s\r" +
      "1048576000 bytes (1.0 GB, 1000 MiB) copied, 10 s, 105 MB/s"
    const r = parseDdProgress(chunk)
    expect(r!.bytes).toBe(1048576000)
    expect(r!.seconds).toBe(10)
  })

  it("parses the final summary line with float seconds (and surrounding records lines)", () => {
    const out = "256+0 records in\n256+0 records out\n268435456 bytes (268 MB, 256 MiB) copied, 2.5 s, 107 MB/s\n"
    const r = parseDdProgress(out)
    expect(r!.bytes).toBe(268435456)
    expect(r!.seconds).toBe(2.5)
    expect(r!.bytesPerSec).toBeCloseTo(107374182.4, 0)
  })

  it("parses a line without the human-readable size parenthetical", () => {
    const r = parseDdProgress("500000 bytes copied, 5 s, 100 kB/s")
    expect(r!.bytes).toBe(500000)
    expect(r!.seconds).toBe(5)
  })

  it("returns null when there is no progress line", () => {
    expect(parseDdProgress("dd: error writing '/dev/sdx': No space left on device")).toBeNull()
    expect(parseDdProgress("")).toBeNull()
  })

  it("reports a zero rate (not NaN/Infinity) when elapsed seconds is 0", () => {
    const r = parseDdProgress("4194304 bytes (4.2 MB, 4.0 MiB) copied, 0 s, 0 B/s")
    expect(r!.bytes).toBe(4194304)
    expect(r!.bytesPerSec).toBe(0)
  })
})

describe("createDdProgressAccumulator", () => {
  it("passes a single dd's monotonic counter through unchanged", () => {
    const acc = createDdProgressAccumulator()
    expect(acc("104857600 bytes (105 MB, 100 MiB) copied, 1 s, 105 MB/s")!.bytes).toBe(104857600)
    expect(acc("524288000 bytes (524 MB, 500 MiB) copied, 5 s, 105 MB/s")!.bytes).toBe(524288000)
  })

  it("folds the previous dd's total when the counter restarts (#502)", () => {
    // The apply path runs one dd per extent, so the status=progress counter
    // restarts at 0 for every extent — the customer log showed "copying 0.0 GB"
    // at the start of each batch. A drop in the counter means a new dd started.
    const acc = createDdProgressAccumulator()
    acc("1073741824 bytes (1.1 GB, 1.0 GiB) copied, 10 s, 107 MB/s")
    const r = acc("4194304 bytes (4.2 MB, 4.0 MiB) copied, 0.1 s, 42 MB/s")
    expect(r!.bytes).toBe(1073741824 + 4194304)
  })

  it("folds every restart when one chunk carries several dd completions", () => {
    const acc = createDdProgressAccumulator()
    const r = acc("100 bytes copied, 1 s\n50 bytes copied, 1 s\n30 bytes copied, 1 s")
    expect(r!.bytes).toBe(180)
  })

  it("returns null on a chunk without progress lines and keeps its running total", () => {
    const acc = createDdProgressAccumulator()
    acc("100 bytes copied, 1 s")
    expect(acc("1024+0 records in\n1024+0 records out")).toBeNull()
    expect(acc("50 bytes copied, 1 s")!.bytes).toBe(150)
  })

  it("reports the latest dd's own rate, not a cumulative one", () => {
    const acc = createDdProgressAccumulator()
    acc("1000 bytes copied, 1 s")
    const r = acc("500 bytes copied, 5 s")
    expect(r!.bytes).toBe(1500)
    expect(r!.bytesPerSec).toBe(100)
    expect(r!.seconds).toBe(5)
  })
})
