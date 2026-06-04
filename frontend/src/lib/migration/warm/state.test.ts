import { describe, it, expect } from "vitest"
import { initDiskState, recordPass } from "./state"

describe("per-disk warm state", () => {
  it("chains changeIds across passes and accumulates bytes", () => {
    let s = initDiskState(2000)
    s = recordPass(s, { newChangeId: "cidA", bytes: 1000 })
    s = recordPass(s, { newChangeId: "cidB", bytes: 200 })
    expect(s.prevChangeId).toBe("cidA")
    expect(s.currentChangeId).toBe("cidB")
    expect(s.passIndex).toBe(2)
    expect(s.bytesDone).toBe(1200)
  })
})
