import { describe, it, expect } from "vitest"
import { decideNextPass } from "./convergence"

const cfg = { downtimeBudgetSec: 300, maxPasses: 5, shutdownSec: 20, bootSec: 30 }

describe("decideNextPass", () => {
  it("cuts over when the projected downtime fits the budget", () => {
    const result = decideNextPass(1, { deltaBytes: 50 * 1024 * 1024, throughputBytesPerSec: 100 * 1024 * 1024 }, cfg)
    expect(result.action).toBe("cutover")
    expect(result.projectedDowntimeSec).toBe(51)
  })
  it("does another delta pass when over budget and passes remain", () => {
    const result = decideNextPass(1, { deltaBytes: 200 * 1024 ** 3, throughputBytesPerSec: 100 * 1024 * 1024 }, cfg)
    expect(result).toMatchObject({ action: "delta", pass: 2 })
    expect(result.projectedDowntimeSec).toBeGreaterThan(cfg.downtimeBudgetSec)
  })
  it("operator-gates when over budget at the last pass", () => {
    const d = decideNextPass(4, { deltaBytes: 200 * 1024 ** 3, throughputBytesPerSec: 100 * 1024 * 1024 }, cfg)
    expect(d.action).toBe("operator-gate")
  })
  it("exposes a rounded projected downtime on every decision", () => {
    const cutover = decideNextPass(1, { deltaBytes: 50 * 1024 * 1024, throughputBytesPerSec: 100 * 1024 * 1024 }, cfg)
    expect(cutover.action).toBe("cutover")
    expect(cutover.projectedDowntimeSec).toBe(51) // 20 + 30 + ~0.5s transfer, rounded

    const delta = decideNextPass(0, { deltaBytes: 200 * 1024 ** 3, throughputBytesPerSec: 100 * 1024 * 1024 }, cfg)
    expect(delta.action).toBe("delta")
    expect(delta.projectedDowntimeSec).toBeGreaterThan(cfg.downtimeBudgetSec)
  })
  it("treats a zero-byte delta as zero transfer time (empty/thin VM cuts over)", () => {
    const d = decideNextPass(0, { deltaBytes: 0, throughputBytesPerSec: 0 }, cfg)
    expect(d.action).toBe("cutover")
    expect(d.projectedDowntimeSec).toBe(cfg.shutdownSec + cfg.bootSec)
  })
  it("keeps projected downtime finite and within the DB int range when throughput is unknown", () => {
    const d = decideNextPass(0, { deltaBytes: 10 * 1024 ** 3, throughputBytesPerSec: 0 }, cfg)
    expect(Number.isFinite(d.projectedDowntimeSec)).toBe(true)
    expect(d.projectedDowntimeSec).toBeLessThanOrEqual(2_147_483_647)
  })
})
