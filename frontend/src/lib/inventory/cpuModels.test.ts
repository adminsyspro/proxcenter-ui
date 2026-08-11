import { describe, expect, it } from "vitest"

import { extractCustomCpuModels, isKnownCpuType } from "./cpuModels"

describe("isKnownCpuType", () => {
  it("returns true for built-in CPU types offered by the static Selects", () => {
    expect(isKnownCpuType("host")).toBe(true)
    expect(isKnownCpuType("x86-64-v2-AES")).toBe(true)
    expect(isKnownCpuType("EPYC-Milan")).toBe(true)
  })

  it("returns false for custom models and unknown names", () => {
    expect(isKnownCpuType("custom-foo")).toBe(false)
    expect(isKnownCpuType("Denverton")).toBe(false)
  })
})

describe("extractCustomCpuModels", () => {
  it("prefixes custom models reported without the custom- prefix", () => {
    const data = [{ name: "migration-safe", custom: 1 }]
    expect(extractCustomCpuModels(data)).toEqual(["custom-migration-safe"])
  })

  it("keeps models already carrying the custom- prefix unchanged", () => {
    const data = [{ name: "custom-migration-safe", custom: 1 }]
    expect(extractCustomCpuModels(data)).toEqual(["custom-migration-safe"])
  })

  it("ignores builtin entries", () => {
    const data = [{ name: "kvm64" }, { name: "x86-64-v3", custom: 0 }]
    expect(extractCustomCpuModels(data)).toEqual([])
  })

  it("deduplicates and sorts the result", () => {
    const data = [
      { name: "zeta", custom: 1 },
      { name: "custom-alpha" },
      { name: "custom-zeta", custom: 1 },
      { name: "alpha", custom: true },
    ]
    expect(extractCustomCpuModels(data)).toEqual(["custom-alpha", "custom-zeta"])
  })

  it("skips invalid entries", () => {
    const data = [null, {}, { name: 42, custom: 1 }, { name: "   ", custom: 1 }]
    expect(extractCustomCpuModels(data)).toEqual([])
  })

  it("returns [] for non-array input", () => {
    expect(extractCustomCpuModels(null)).toEqual([])
    expect(extractCustomCpuModels(undefined)).toEqual([])
    expect(extractCustomCpuModels({ name: "custom-foo" })).toEqual([])
    expect(extractCustomCpuModels("custom-foo")).toEqual([])
  })
})
