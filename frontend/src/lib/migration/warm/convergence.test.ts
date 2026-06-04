import { describe, it, expect } from "vitest"
import { decideNextPass } from "./convergence"

const cfg = { downtimeBudgetSec: 300, maxPasses: 5, shutdownSec: 20, bootSec: 30 }

describe("decideNextPass", () => {
  it("cuts over when the projected downtime fits the budget", () => {
    expect(decideNextPass(1, { deltaBytes: 50 * 1024 * 1024, throughputBytesPerSec: 100 * 1024 * 1024 }, cfg))
      .toEqual({ action: "cutover" })
  })
  it("does another delta pass when over budget and passes remain", () => {
    expect(decideNextPass(1, { deltaBytes: 200 * 1024 ** 3, throughputBytesPerSec: 100 * 1024 * 1024 }, cfg))
      .toEqual({ action: "delta", pass: 2 })
  })
  it("operator-gates when over budget at the last pass", () => {
    const d = decideNextPass(4, { deltaBytes: 200 * 1024 ** 3, throughputBytesPerSec: 100 * 1024 * 1024 }, cfg)
    expect(d.action).toBe("operator-gate")
  })
})
