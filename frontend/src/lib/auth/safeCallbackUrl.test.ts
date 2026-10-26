import { describe, expect, it } from "vitest"

import { safeCallbackUrl } from "./safeCallbackUrl"

describe("safeCallbackUrl", () => {
  it("keeps a relative path with its query string", () => {
    expect(safeCallbackUrl("/inventory?tab=vms")).toBe("/inventory?tab=vms")
    expect(safeCallbackUrl("/")).toBe("/")
  })

  it("falls back to / for anything that is not a relative path", () => {
    for (const bad of [
      "//example.org/",
      "/\\example.org/",
      "https://example.org/x",
      "http://localhost:3000/home",
      "javascript:alert(1)",
      "inventory",
      "",
      "   ",
      "/home\nSet-Cookie: a=b",
      "/ho me",
    ]) {
      expect(safeCallbackUrl(bad), bad).toBe("/")
    }
  })

  it("falls back to / for a missing or non-string value", () => {
    expect(safeCallbackUrl(null)).toBe("/")
    expect(safeCallbackUrl(undefined)).toBe("/")
    expect(safeCallbackUrl(42)).toBe("/")
    expect(safeCallbackUrl(["/home"])).toBe("/")
  })

  it("trims surrounding whitespace before deciding", () => {
    expect(safeCallbackUrl("  /home ")).toBe("/home")
  })

  it("refuses an oversized value", () => {
    expect(safeCallbackUrl("/" + "a".repeat(3000))).toBe("/")
  })
})
