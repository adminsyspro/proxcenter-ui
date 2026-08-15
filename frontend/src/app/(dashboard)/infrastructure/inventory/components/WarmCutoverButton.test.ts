import { describe, it, expect } from "vitest"

import { canRequestCutover, isAwaitingOperator, isWarmHold } from "./WarmCutoverButton"

const hold = { id: "j1", status: "delta_sync", projectedDowntimeSec: 59, config: { cutoverMode: "manual" } }
const auto = { id: "j2", status: "delta_sync", projectedDowntimeSec: 59, config: { cutoverMode: "auto" } }
const gate = { id: "j3", status: "awaiting_cutover", projectedDowntimeSec: 2505, config: { cutoverMode: "auto" } }

describe("isWarmHold", () => {
  it("recognises a manual run still replicating", () => {
    expect(isWarmHold(hold)).toBe(true)
  })

  it("is false for an automatic run in the same status", () => {
    // Same status, opposite meaning: this one is converging towards its own
    // cutover, nobody is waiting on a human.
    expect(isWarmHold(auto)).toBe(false)
    expect(isWarmHold({ ...hold, config: null })).toBe(false)
  })

  it("is false once the hold has moved on", () => {
    expect(isWarmHold({ ...hold, status: "cutover" })).toBe(false)
    expect(isWarmHold(null)).toBe(false)
  })
})

describe("isAwaitingOperator", () => {
  it("covers both ways a migration ends up waiting on a human", () => {
    expect(isAwaitingOperator(hold)).toBe(true)
    expect(isAwaitingOperator(gate)).toBe(true)
  })

  it("leaves a converging run alone", () => {
    expect(isAwaitingOperator(auto)).toBe(false)
    expect(isAwaitingOperator(undefined)).toBe(false)
  })
})

describe("canRequestCutover", () => {
  it("allows the request from delta_sync and from the gate", () => {
    expect(canRequestCutover(auto)).toBe(true)
    expect(canRequestCutover(hold)).toBe(true)
    expect(canRequestCutover(gate)).toBe(true)
  })

  it("refuses before the first estimate exists", () => {
    // projectedDowntimeSec is written after the first delta pass; earlier there
    // is nothing to show and no change id to resume from.
    expect(canRequestCutover({ ...auto, projectedDowntimeSec: null })).toBe(false)
  })

  it("refuses outside the delta phase", () => {
    for (const status of ["planning", "full_copy", "cutover", "verify", "completed", "failed"]) {
      expect(canRequestCutover({ ...auto, status })).toBe(false)
    }
    expect(canRequestCutover(null)).toBe(false)
  })
})
