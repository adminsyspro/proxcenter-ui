import { describe, it, expect } from "vitest"
import { planPasses, buildThickZeroScript } from "./warm-pipeline"

const GiB = 1024 ** 3
const MiB = 1024 * 1024
const cfg = { downtimeBudgetSec: 300, maxPasses: 5, shutdownSec: 20, bootSec: 30 }

describe("planPasses", () => {
  it("stops at cutover once the projected downtime fits the budget", () => {
    const actions = planPasses(
      [{ deltaBytes: 50 * GiB, throughputBytesPerSec: 100 * MiB },
       { deltaBytes: 30 * MiB, throughputBytesPerSec: 100 * MiB }],
      cfg)
    expect(actions[actions.length - 1]).toEqual({ action: "cutover" })
  })

  it("cuts over immediately when the very first delta already fits the budget", () => {
    const actions = planPasses([{ deltaBytes: 10 * MiB, throughputBytesPerSec: 100 * MiB }], cfg)
    expect(actions).toEqual([{ action: "cutover" }])
  })

  it("escalates to an operator gate when max passes is reached without meeting the budget", () => {
    // every pass stays far above budget -> never auto-cutover, hit the safety cap
    const stats = Array.from({ length: 5 }, () => ({ deltaBytes: 50 * GiB, throughputBytesPerSec: 100 * MiB }))
    const actions = planPasses(stats, cfg)
    expect(actions[actions.length - 1].action).toBe("operator-gate")
  })

  it("keeps issuing delta passes while above budget and below the cap", () => {
    const stats = Array.from({ length: 3 }, () => ({ deltaBytes: 50 * GiB, throughputBytesPerSec: 100 * MiB }))
    const actions = planPasses(stats, cfg)
    expect(actions.every(a => a.action === "delta")).toBe(true)
    expect(actions).toHaveLength(3)
  })
})

describe("buildThickZeroScript", () => {
  const dev = "/dev/vg-ld6-isp/vm-116-disk-1"

  it("queries the exact device size and bounds the zero-fill to it", () => {
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain("blockdev --getsize64")
    // the bound is the byte size read back from the device
    expect(cmd).toContain('head -c "$sz" /dev/zero')
  })

  it("does NOT emit the unbounded dd that ENOSPCs past end-of-device (#445)", () => {
    // A bare `dd if=/dev/zero of=DEV bs=4M oflag=direct` with no count fills the
    // device, then writes one block past the end -> ENOSPC -> exit 1, even after
    // a full zero. Guard that the broken form never comes back.
    const cmd = buildThickZeroScript(dev)
    expect(cmd).not.toMatch(/dd if=\/dev\/zero of=/)
  })

  it("prefers blkdiscard -z and only streams zeros on its failure", () => {
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain(`blkdiscard -z '${dev}'`)
    // blkdiscard || stream: the stream is the fallback, not the primary path
    expect(cmd.indexOf("blkdiscard -z")).toBeLessThan(cmd.indexOf("|| head -c"))
  })

  it("keeps O_DIRECT with full 4 MiB blocks reassembled across the pipe", () => {
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain("bs=4M iflag=fullblock oflag=direct")
  })

  it("single-quotes the device in every write/read position", () => {
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain(`blockdev --getsize64 '${dev}'`)
    expect(cmd).toContain(`blkdiscard -z '${dev}'`)
    expect(cmd).toContain(`dd of='${dev}'`)
  })

  it("escapes an embedded single quote in the device path", () => {
    const cmd = buildThickZeroScript("/dev/x'y")
    expect(cmd).toContain(`'/dev/x'\\''y'`)
  })
})
