import { describe, expect, it } from "vitest"

import { applySourceSizing, hypervSourceSizing, normalizeSourceMac, nutanixSourceSizing } from "./source-sizing"

describe("hypervSourceSizing", () => {
  it("keeps the processor count and startup memory of the source VM", () => {
    expect(hypervSourceSizing({ cpuCount: 1, memoryMB: 4096 })).toEqual({ source: "Hyper-V", cores: 1, memoryMB: 4096, nics: [] })
  })

  it("returns null when the host reported nothing usable", () => {
    expect(hypervSourceSizing({ cpuCount: 0, memoryMB: 0 })).toBeNull()
    expect(hypervSourceSizing(undefined)).toBeNull()
    expect(hypervSourceSizing({ cpuCount: Number.NaN, memoryMB: -1 })).toBeNull()
  })

  it("keeps a partial report", () => {
    expect(hypervSourceSizing({ cpuCount: 4 })).toEqual({ source: "Hyper-V", cores: 4, memoryMB: 0, nics: [] })
    expect(hypervSourceSizing({ memoryMB: 8192.4 })).toEqual({ source: "Hyper-V", cores: 0, memoryMB: 8192, nics: [] })
  })

  it("keeps every network adapter in order with its source MAC", () => {
    const sizing = hypervSourceSizing({
      cpuCount: 2,
      memoryMB: 4096,
      networkAdapters: [{ macAddress: "00155D63BE02" }, { macAddress: "00155D63BE99" }],
    })
    expect(sizing?.nics).toEqual([{ mac: "00:15:5D:63:BE:02" }, { mac: "00:15:5D:63:BE:99" }])
  })

  it("keeps an adapter whose dynamic MAC was never assigned, without a MAC", () => {
    expect(hypervSourceSizing({ networkAdapters: [{ macAddress: "000000000000" }] })).toEqual({
      source: "Hyper-V", cores: 0, memoryMB: 0, nics: [{}],
    })
  })
})

describe("nutanixSourceSizing", () => {
  it("uses the flattened vCPU count and memory_size_mib", () => {
    expect(nutanixSourceSizing({ numCpus: 8, memoryMB: 16384 })).toEqual({ source: "Nutanix", cores: 8, memoryMB: 16384, nics: [] })
    expect(nutanixSourceSizing(null)).toBeNull()
  })

  it("keeps every NIC of nic_list with its MAC", () => {
    expect(nutanixSourceSizing({ numCpus: 2, nics: [{ macAddress: "50:6b:8d:aa:bb:cc" }, { macAddress: "" }] })?.nics)
      .toEqual([{ mac: "50:6B:8D:AA:BB:CC" }, {}])
  })
})

describe("normalizeSourceMac", () => {
  it("accepts bare, colon and dash forms and returns the Proxmox form", () => {
    expect(normalizeSourceMac("00155d63be02")).toBe("00:15:5D:63:BE:02")
    expect(normalizeSourceMac("50:6b:8d:aa:bb:cc")).toBe("50:6B:8D:AA:BB:CC")
    expect(normalizeSourceMac("00-15-5D-63-BE-02")).toBe("00:15:5D:63:BE:02")
  })

  it("drops what Proxmox would refuse or what is not a MAC", () => {
    expect(normalizeSourceMac("000000000000")).toBeUndefined()
    expect(normalizeSourceMac("01:00:5E:00:00:01")).toBeUndefined()
    expect(normalizeSourceMac("00155D63BE")).toBeUndefined()
    expect(normalizeSourceMac("not-a-mac-at")).toBeUndefined()
    expect(normalizeSourceMac(undefined)).toBeUndefined()
    expect(normalizeSourceMac(42)).toBeUndefined()
  })
})

describe("applySourceSizing", () => {
  it("replaces the virt-v2v placeholders and describes the change", () => {
    const vmConfig = { cores: 1, memory: 2048, nics: [{ model: "virtio" }] }
    const line = applySourceSizing(vmConfig, { source: "Hyper-V", cores: 2, memoryMB: 4096, nics: [] })
    expect(vmConfig).toEqual({ cores: 2, memory: 4096, nics: [{ model: "virtio" }] })
    expect(line).toBe("Overriding virt-v2v defaults with Hyper-V source values: cores 1->2, memory 2048MB->4096MB")
  })

  it("leaves untouched what the source did not report", () => {
    const vmConfig = { cores: 1, memory: 2048, nics: [{ model: "virtio" }] }
    expect(applySourceSizing(vmConfig, { source: "Nutanix", cores: 0, memoryMB: 8192, nics: [] })).toContain("cores 1->1, memory 2048MB->8192MB")
    expect(vmConfig).toEqual({ cores: 1, memory: 8192, nics: [{ model: "virtio" }] })
  })

  it("recreates one NIC per source NIC with its MAC, on the model virt-v2v picked", () => {
    const vmConfig = { cores: 2, memory: 4096, nics: [{ model: "rtl8139" }] }
    const line = applySourceSizing(vmConfig, {
      source: "Hyper-V", cores: 2, memoryMB: 4096, nics: [{ mac: "00:15:5D:63:BE:02" }, {}],
    })
    expect(vmConfig.nics).toEqual([{ model: "rtl8139", mac: "00:15:5D:63:BE:02" }, { model: "rtl8139" }])
    expect(line).toBe("Overriding virt-v2v defaults with Hyper-V source values: cores 2->2, memory 4096MB->4096MB, NICs 1->2")
  })

  it("falls back to virtio when virt-v2v reported no interface", () => {
    const vmConfig: { cores: number; memory: number; nics: { model: string; mac?: string }[] } = { cores: 1, memory: 2048, nics: [] }
    applySourceSizing(vmConfig, { source: "Nutanix", cores: 0, memoryMB: 0, nics: [{ mac: "50:6B:8D:AA:BB:CC" }] })
    expect(vmConfig.nics).toEqual([{ model: "virtio", mac: "50:6B:8D:AA:BB:CC" }])
  })
})
