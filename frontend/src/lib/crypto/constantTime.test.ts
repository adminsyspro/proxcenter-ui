import { describe, expect, it } from "vitest"

import { constantTimeStringEqual } from "./constantTime"

describe("constantTimeStringEqual", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeStringEqual("shared-secret", "shared-secret")).toBe(true)
  })

  it("returns false for different strings of equal length", () => {
    expect(constantTimeStringEqual("shared-secret", "sharee-secret")).toBe(false)
  })

  it("returns false for different lengths without throwing", () => {
    expect(constantTimeStringEqual("short", "a-much-longer-value")).toBe(false)
  })

  it("treats two empty strings as equal", () => {
    expect(constantTimeStringEqual("", "")).toBe(true)
  })

  it("treats an empty string against a non-empty one as unequal", () => {
    expect(constantTimeStringEqual("", "x")).toBe(false)
  })
})
