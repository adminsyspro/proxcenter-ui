import { describe, it, expect } from "vitest"
import { planPasses } from "./warm-pipeline"

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
