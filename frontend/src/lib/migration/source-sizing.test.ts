import { describe, expect, it } from "vitest"

import { applySourceSizing, hypervSourceSizing, nutanixSourceSizing } from "./source-sizing"

describe("hypervSourceSizing", () => {
  it("keeps the processor count and startup memory of the source VM", () => {
    expect(hypervSourceSizing({ cpuCount: 1, memoryMB: 4096 })).toEqual({ source: "Hyper-V", cores: 1, memoryMB: 4096 })
  })

  it("returns null when the host reported nothing usable", () => {
    expect(hypervSourceSizing({ cpuCount: 0, memoryMB: 0 })).toBeNull()
    expect(hypervSourceSizing(undefined)).toBeNull()
    expect(hypervSourceSizing({ cpuCount: Number.NaN, memoryMB: -1 })).toBeNull()
  })

  it("keeps a partial report", () => {
    expect(hypervSourceSizing({ cpuCount: 4 })).toEqual({ source: "Hyper-V", cores: 4, memoryMB: 0 })
    expect(hypervSourceSizing({ memoryMB: 8192.4 })).toEqual({ source: "Hyper-V", cores: 0, memoryMB: 8192 })
  })
})

describe("nutanixSourceSizing", () => {
  it("uses the flattened vCPU count and memory_size_mib", () => {
    expect(nutanixSourceSizing({ numCpus: 8, memoryMB: 16384 })).toEqual({ source: "Nutanix", cores: 8, memoryMB: 16384 })
    expect(nutanixSourceSizing(null)).toBeNull()
  })
})

describe("applySourceSizing", () => {
  it("replaces the virt-v2v placeholders and describes the change", () => {
    const vmConfig = { cores: 1, memory: 2048 }
    const line = applySourceSizing(vmConfig, { source: "Hyper-V", cores: 2, memoryMB: 4096 })
    expect(vmConfig).toEqual({ cores: 2, memory: 4096 })
    expect(line).toBe("Overriding virt-v2v defaults with Hyper-V source values: cores 1->2, memory 2048MB->4096MB")
  })

  it("leaves untouched what the source did not report", () => {
    const vmConfig = { cores: 1, memory: 2048 }
    expect(applySourceSizing(vmConfig, { source: "Nutanix", cores: 0, memoryMB: 8192 })).toContain("cores 1->1, memory 2048MB->8192MB")
    expect(vmConfig).toEqual({ cores: 1, memory: 8192 })
  })
})
