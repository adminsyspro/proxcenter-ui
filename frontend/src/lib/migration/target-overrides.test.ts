import { describe, it, expect } from "vitest"

import {
  parseHardwareOverrides, parseNicMappings, isAcceptableCpuType, resolveNicTarget,
  buildNetValue, applyHardwareOverrides, describeOverrides, MAX_NICS,
} from "./target-overrides"

describe("parseHardwareOverrides", () => {
  it("resolves absent or empty input to undefined", () => {
    expect(parseHardwareOverrides(undefined)).toEqual({ ok: true, value: undefined })
    expect(parseHardwareOverrides(null)).toEqual({ ok: true, value: undefined })
    expect(parseHardwareOverrides({})).toEqual({ ok: true, value: undefined })
    expect(parseHardwareOverrides({ cores: "", sockets: null })).toEqual({ ok: true, value: undefined })
  })

  it("accepts integers and numeric strings inside the Proxmox limits", () => {
    expect(parseHardwareOverrides({ cores: 4, sockets: "2", memoryMB: 8192 })).toEqual({ ok: true, value: { cores: 4, sockets: 2, memoryMB: 8192 } })
    expect(parseHardwareOverrides({ memoryMB: 16 })).toEqual({ ok: true, value: { memoryMB: 16 } })
  })

  it.each([
    [{ cores: 0 }, "hardware.cores"],
    [{ cores: 129 }, "hardware.cores"],
    [{ cores: 2.5 }, "hardware.cores"],
    [{ sockets: 5 }, "hardware.sockets"],
    [{ memoryMB: 8 }, "hardware.memoryMB"],
    [{ memoryMB: "lots" }, "hardware.memoryMB"],
  ])("rejects %j", (raw, field) => {
    const r = parseHardwareOverrides(raw)
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toContain(field)
  })

  it("rejects a non-object", () => {
    expect(parseHardwareOverrides([1]).ok).toBe(false)
    expect(parseHardwareOverrides("4").ok).toBe(false)
  })
})

describe("parseNicMappings", () => {
  it("resolves absent or empty input to undefined", () => {
    expect(parseNicMappings(undefined)).toEqual({ ok: true, value: undefined })
    expect(parseNicMappings([])).toEqual({ ok: true, value: undefined })
  })

  it("accepts bridges, VNets, tags and models, sorted by index", () => {
    const r = parseNicMappings([
      { index: "1", bridge: "vf95117a", vlanTag: "", model: "e1000" },
      { index: 0, bridge: "vmbr0", vlanTag: 42 },
    ])
    expect(r).toEqual({ ok: true, value: [{ index: 0, bridge: "vmbr0", vlanTag: 42 }, { index: 1, bridge: "vf95117a", model: "e1000" }] })
  })

  it.each([
    ["not an array", "nics must be an array"],
    [[null], "entries must be objects"],
    [[{ index: -1, bridge: "vmbr0" }], "index"],
    [[{ index: 0, bridge: "vmbr0" }, { index: 0, bridge: "vmbr1" }], "listed twice"],
    [[{ index: 0, bridge: "" }], "bridge"],
    [[{ index: 0, bridge: "vmbr0; rm -rf /" }], "bridge"],
    [[{ index: 0, bridge: "vmbr0", vlanTag: 4095 }], "vlanTag"],
    [[{ index: 0, bridge: "vmbr0", model: "ne2k" }], "model"],
    [Array.from({ length: MAX_NICS + 1 }, (_, i) => ({ index: i, bridge: "vmbr0" })), "more than"],
  ])("rejects %j", (raw, message) => {
    const r = parseNicMappings(raw)
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toContain(message)
  })
})

describe("isAcceptableCpuType", () => {
  it("accepts QEMU models Proxmox knows and cluster custom models", () => {
    for (const v of ["host", "x86-64-v2-AES", "kvm64", "EPYC-Rome", "custom-gold", "custom-my.model_1"]) expect(isAcceptableCpuType(v)).toBe(true)
  })
  it("refuses anything that could not be a model name", () => {
    for (const v of ["", "host; reboot", "custom-", "custom-a b", 42, null, "x".repeat(65)]) expect(isAcceptableCpuType(v)).toBe(false)
  })
})

describe("resolveNicTarget / buildNetValue", () => {
  const nics = [{ index: 1, bridge: "vf95117a", vlanTag: 20, model: "e1000" }, { index: 2, bridge: "vmbr1" }]
  it("falls back to the defaults for an unmapped NIC", () => {
    expect(resolveNicTarget(0, nics, { bridge: "vmbr0", vlanTag: 5 })).toEqual({ bridge: "vmbr0", vlanTag: 5 })
    expect(resolveNicTarget(0, undefined, { bridge: "vmbr0" })).toEqual({ bridge: "vmbr0", vlanTag: undefined })
  })
  it("applies the mapping, keeping the default tag when the mapping has none", () => {
    expect(resolveNicTarget(1, nics, { bridge: "vmbr0", vlanTag: 5 })).toEqual({ bridge: "vf95117a", vlanTag: 20, model: "e1000" })
    expect(resolveNicTarget(2, nics, { bridge: "vmbr0", vlanTag: 5 })).toEqual({ bridge: "vmbr1", vlanTag: 5, model: undefined })
  })
  it("formats the netN value, dropping a malformed MAC and an out-of-range tag", () => {
    expect(buildNetValue("virtio", "vmbr0", "00:50:56:aa:bb:cc", 42)).toBe("virtio,bridge=vmbr0,macaddr=00:50:56:aa:bb:cc,tag=42")
    expect(buildNetValue("e1000", "vmbr1", "nope", 5000)).toBe("e1000,bridge=vmbr1")
    expect(buildNetValue("virtio", "vmbr1")).toBe("virtio,bridge=vmbr1")
  })
})

describe("applyHardwareOverrides / describeOverrides", () => {
  it("overrides only the fields that were given", () => {
    expect(applyHardwareOverrides({ cores: 2, sockets: 1, memory: 1024 }, { memoryMB: 4096 })).toEqual({ cores: 2, sockets: 1, memory: 4096 })
    expect(applyHardwareOverrides({ cores: 2, sockets: 1, memory: 1024 }, undefined)).toEqual({ cores: 2, sockets: 1, memory: 1024 })
    expect(applyHardwareOverrides({ cores: 2, sockets: 1, memory: 1024 }, { cores: 4, sockets: 2 })).toEqual({ cores: 4, sockets: 2, memory: 1024 })
  })
  it("describes the operator changes for the job log", () => {
    expect(describeOverrides(undefined)).toBeNull()
    expect(describeOverrides({ hardware: {}, nics: [] })).toBeNull()
    expect(describeOverrides({ hardware: { cores: 4, memoryMB: 2048 }, nics: [{ index: 1, bridge: "vf95117a", vlanTag: 20, model: "e1000" }] }))
      .toBe("Operator overrides: hardware cores=4, memory=2048MB; NICs net1->vf95117a tag 20 (e1000)")
  })
})
