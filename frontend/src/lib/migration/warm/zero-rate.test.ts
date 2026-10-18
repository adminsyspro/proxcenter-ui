import { describe, it, expect } from "vitest"
import {
  parseZeroRateLimit, isZeroRateLimitValid, zeroSliceBytes, describeZeroRateLimit,
  ZERO_RATE_MIB, ZERO_SLICE_MAX_BYTES, ZERO_SLICE_ALIGN_BYTES, ZERO_RATE_LIMIT_MAX_MBPS,
} from "./zero-rate"

describe("parseZeroRateLimit", () => {
  it("treats absent, null and empty as 'not set' so the target connection's cap applies", () => {
    expect(parseZeroRateLimit(undefined)).toBeUndefined()
    expect(parseZeroRateLimit(null)).toBeUndefined()
    expect(parseZeroRateLimit("")).toBeUndefined()
  })
  it("accepts 0 (unlimited) and integers within bounds, as numbers or strings", () => {
    expect(parseZeroRateLimit(0)).toBe(0)
    expect(parseZeroRateLimit("0")).toBe(0)
    expect(parseZeroRateLimit(1)).toBe(1)
    expect(parseZeroRateLimit(" 250 ")).toBe(250)
    expect(parseZeroRateLimit(ZERO_RATE_LIMIT_MAX_MBPS)).toBe(ZERO_RATE_LIMIT_MAX_MBPS)
  })
  it("rejects negatives, fractions, text and values past the ceiling", () => {
    for (const bad of [-1, 0.5, "12.5", "fast", NaN, Infinity, ZERO_RATE_LIMIT_MAX_MBPS + 1, {}]) {
      expect(parseZeroRateLimit(bad)).toBeNull()
    }
  })
  it("isZeroRateLimitValid mirrors it for the dialog field (empty is valid)", () => {
    expect(isZeroRateLimitValid("")).toBe(true)
    expect(isZeroRateLimitValid("  ")).toBe(true)
    expect(isZeroRateLimitValid("100")).toBe(true)
    expect(isZeroRateLimitValid("-3")).toBe(false)
    expect(isZeroRateLimitValid("1e3")).toBe(false)
  })
})

describe("zeroSliceBytes", () => {
  it("uses the 1 GiB slice when unlimited", () => {
    expect(zeroSliceBytes(0)).toBe(ZERO_SLICE_MAX_BYTES)
    expect(zeroSliceBytes(-5)).toBe(ZERO_SLICE_MAX_BYTES)
  })
  it("sizes a capped slice to about a quarter second of the allowed rate, 4 MiB aligned", () => {
    // 100 MB/s -> 25 MB per quarter second -> 24 MiB once aligned down
    expect(zeroSliceBytes(100 * ZERO_RATE_MIB)).toBe(24 * ZERO_RATE_MIB)
    expect(zeroSliceBytes(100 * ZERO_RATE_MIB) % ZERO_SLICE_ALIGN_BYTES).toBe(0)
  })
  it("never goes below one 4 MiB block nor above the unlimited slice", () => {
    expect(zeroSliceBytes(1 * ZERO_RATE_MIB)).toBe(ZERO_SLICE_ALIGN_BYTES)
    expect(zeroSliceBytes(ZERO_RATE_LIMIT_MAX_MBPS * ZERO_RATE_MIB)).toBe(ZERO_SLICE_MAX_BYTES)
  })
})

describe("describeZeroRateLimit", () => {
  it("names unlimited and a cap", () => {
    expect(describeZeroRateLimit(0)).toBe("unlimited")
    expect(describeZeroRateLimit(undefined)).toBe("unlimited")
    expect(describeZeroRateLimit(null)).toBe("unlimited")
    expect(describeZeroRateLimit(250)).toBe("250 MB/s")
  })
})
