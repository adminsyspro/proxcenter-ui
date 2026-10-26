import { describe, it, expect, vi, afterEach } from "vitest"

import { readTimeoutEnv } from "./timeoutEnv"

describe("readTimeoutEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("falls back when the variable is absent", () => {
    vi.stubEnv("PBS_TIMEOUT_MS", "")
    expect(readTimeoutEnv("PBS_TIMEOUT_MS", 15_000, "pbs")).toBe(15_000)
  })

  it("reads a positive number of milliseconds", () => {
    vi.stubEnv("PBS_TIMEOUT_MS", "25000")
    expect(readTimeoutEnv("PBS_TIMEOUT_MS", 15_000, "pbs")).toBe(25_000)
  })

  it.each(["abc", "0", "-5"])("ignores %s with a tagged warning", (raw) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubEnv("PBS_TIMEOUT_MS", raw)

    expect(readTimeoutEnv("PBS_TIMEOUT_MS", 15_000, "pbs")).toBe(15_000)
    expect(warn).toHaveBeenCalledWith(`[pbs] Ignoring invalid PBS_TIMEOUT_MS="${raw}", using 15000ms instead`)
  })
})
