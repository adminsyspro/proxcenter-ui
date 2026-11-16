import { describe, expect, it } from "vitest"

import { buildRateFileWriteCmd, nbdkitRateFilterArgs, rateFileOf } from "./rate-file"

describe("rate file of a reader", () => {
  it("sits next to the reader's socket", () => {
    expect(rateFileOf("/tmp/proxcenter-vddk-j1-2000.sock")).toBe("/tmp/proxcenter-vddk-j1-2000.sock.rate")
  })

  it("starts the filter at the initial share and points it at the rate file", () => {
    expect(nbdkitRateFilterArgs("/tmp/a.sock", 50)).toEqual({ filters: ["--filter=rate"], params: ["rate=400M", "rate-file='/tmp/a.sock.rate'"] })
  })

  // nbdkit refuses rate=0 at startup (lab 15/11): without a share the filter
  // only watches its file, which it reads as unlimited until one is written.
  it("leaves the rate out when the copy starts unlimited", () => {
    expect(nbdkitRateFilterArgs("/tmp/a.sock", 0)).toEqual({ filters: ["--filter=rate"], params: ["rate-file='/tmp/a.sock.rate'"] })
  })

  // A smaller credit than nbdkit's default (2 s) loses throughput at low caps,
  // reads coming in 4 MiB blocks (lab 16/11: 0.3 MiB/s for a 2 MiB/s cap with
  // 0.25 s): the default is kept, and the start burst is handled in the readout.
  it("keeps nbdkit's default credit", () => {
    expect(nbdkitRateFilterArgs("/tmp/a.sock", 2).params.some(p => p.startsWith("burstiness"))).toBe(false)
  })

  it("rewrites the rate file atomically, escaping the path", () => {
    expect(buildRateFileWriteCmd("/tmp/a b.sock", 20))
      .toBe("printf '%s\\n' 160M > '/tmp/a b.sock.rate.tmp' && mv -f '/tmp/a b.sock.rate.tmp' '/tmp/a b.sock.rate'")
  })

  it("writes 0 to lift the cap", () => {
    expect(buildRateFileWriteCmd("/tmp/a.sock", 0)).toContain("printf '%s\\n' 0 >")
  })
})
