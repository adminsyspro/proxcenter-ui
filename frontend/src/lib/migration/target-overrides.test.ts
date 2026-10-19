import { describe, it, expect } from "vitest"

import {
  parseHardwareOverrides, parseNicMappings, isAcceptableCpuType, resolveNicTarget,
  buildNetValue, applyHardwareOverrides, describeOverrides, MAX_NICS,
  parseDiskMappings, planDiskTargets, planStorages, bytesPerStorage, describeDiskPlan, storageOfVolume, MAX_DISKS,
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

describe("parseDiskMappings (#317, lot 2)", () => {
  it("resolves absent, null and empty to undefined", () => {
    expect(parseDiskMappings(undefined)).toEqual({ ok: true, value: undefined })
    expect(parseDiskMappings(null)).toEqual({ ok: true, value: undefined })
    expect(parseDiskMappings([])).toEqual({ ok: true, value: undefined })
  })

  it("keeps storages and exclusions, sorted by index, and drops entries that change nothing", () => {
    const r = parseDiskMappings([
      { index: 2, exclude: true, targetStorage: "ignored" },
      { index: 0, targetStorage: "CephStoragePool" },
      { index: 3 },
      { index: "1", targetStorage: "ZFS-Pool", exclude: false },
    ])
    expect(r).toEqual({ ok: true, value: [
      { index: 0, targetStorage: "CephStoragePool" },
      { index: 1, targetStorage: "ZFS-Pool" },
      { index: 2, exclude: true },
    ] })
  })

  it.each([
    ["not an array", { index: 0 }, /must be an array/],
    ["a non-object entry", [1], /must be objects/],
    ["a negative index", [{ index: -1, targetStorage: "a" }], /index/],
    ["an index past the bound", [{ index: MAX_DISKS, targetStorage: "a" }], /index/],
    ["a duplicate index", [{ index: 1, targetStorage: "a" }, { index: 1, targetStorage: "b" }], /listed twice/],
    ["a storage name that is a shell command", [{ index: 1, targetStorage: "a;reboot" }], /targetStorage/],
    ["a non-string storage", [{ index: 1, targetStorage: 7 }], /targetStorage/],
    ["a non-boolean exclude", [{ index: 1, exclude: "yes" }], /exclude must be a boolean/],
    ["the boot disk excluded", [{ index: 0, exclude: true }], /boot disk/],
  ])("refuses %s", (_label, raw, message) => {
    const r = parseDiskMappings(raw)
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toMatch(message)
  })

  it("refuses more entries than the bound", () => {
    const raw = Array.from({ length: MAX_DISKS + 1 }, (_, index) => ({ index, targetStorage: "a" }))
    expect(parseDiskMappings(raw).ok).toBe(false)
  })
})

describe("planDiskTargets / describeDiskPlan / bytesPerStorage", () => {
  const disks = [{ cap: 10 }, { cap: 20 }, { cap: 30 }]

  it("puts every disk on the default storage when nothing is mapped", () => {
    const plan = planDiskTargets(disks, undefined, "Ceph")
    expect(plan.kept.map(k => [k.sourceIndex, k.storage])).toEqual([[0, "Ceph"], [1, "Ceph"], [2, "Ceph"]])
    expect(plan.excluded).toEqual([])
    expect(describeDiskPlan(plan, "Ceph")).toBeNull()
    expect(planStorages(plan)).toEqual(["Ceph"])
  })

  it("applies per-disk storages, drops excluded disks and reports mappings past the source list", () => {
    const plan = planDiskTargets(disks, [{ index: 1, targetStorage: "ZFS" }, { index: 2, exclude: true }, { index: 5, targetStorage: "x" }], "Ceph")
    expect(plan.kept.map(k => [k.disk.cap, k.sourceIndex, k.storage])).toEqual([[10, 0, "Ceph"], [20, 1, "ZFS"]])
    expect(plan.excluded).toEqual([2])
    expect(plan.unknown).toEqual([5])
    expect(planStorages(plan)).toEqual(["Ceph", "ZFS"])
    expect(Object.fromEntries(bytesPerStorage(plan, d => d.cap))).toEqual({ Ceph: 10, ZFS: 20 })
    expect(describeDiskPlan(plan, "Ceph")).toBe("Per-disk choices: storage disk 1->Ceph, disk 2->ZFS; excluded disk 3; ignored mapping for missing disk 6")
  })

  it("never drops the boot disk, even from a hand-made mapping", () => {
    const plan = planDiskTargets(disks, [{ index: 0, exclude: true }], "Ceph")
    expect(plan.kept[0].sourceIndex).toBe(0)
    expect(plan.excluded).toEqual([])
  })
})

describe("storageOfVolume", () => {
  it("reads the storage id of a volume id, or falls back", () => {
    expect(storageOfVolume("CephStoragePool:vm-101-disk-0", "x")).toBe("CephStoragePool")
    expect(storageOfVolume("ISO:101/vm-101-disk-1.qcow2", "x")).toBe("ISO")
    expect(storageOfVolume("/dev/sdb", "fallback")).toBe("fallback")
  })
})

describe("guest conversion overrides (#1000)", () => {
  it("keeps the Secure Boot keys off only when the operator turned them off", () => {
    expect(parseHardwareOverrides({ efiPreEnrolledKeys: false })).toEqual({ ok: true, value: { efiPreEnrolledKeys: false } })
    expect(parseHardwareOverrides({ efiPreEnrolledKeys: true })).toEqual({ ok: true, value: undefined })
    expect(parseHardwareOverrides({ efiPreEnrolledKeys: "no" })).toEqual({ ok: false, error: "hardware.efiPreEnrolledKeys must be a boolean" })
    expect(describeOverrides({ hardware: { efiPreEnrolledKeys: false } })).toBe("Operator overrides: hardware EFI disk without pre-enrolled Secure Boot keys")
  })

  it("parses a forced bus, drops 'auto' and refuses anything else", () => {
    expect(parseDiskMappings([{ index: 0, bus: "scsi" }, { index: 1, bus: "auto" }, { index: 2, targetStorage: "Z", bus: "sata" }])).toEqual({ ok: true, value: [
      { index: 0, bus: "scsi" },
      { index: 2, targetStorage: "Z", bus: "sata" },
    ] })
    const r = parseDiskMappings([{ index: 0, bus: "ide" }])
    expect(r).toEqual({ ok: false, error: "disks[0].bus must be one of auto, scsi, sata" })
  })

  it("carries the forced bus to the kept disk and into the job log line", () => {
    const plan = planDiskTargets([{ cap: 1 }, { cap: 2 }], [{ index: 0, bus: "scsi" }, { index: 1, bus: "auto" }], "Ceph")
    expect(plan.kept.map(k => k.bus)).toEqual(["scsi", undefined])
    expect(describeDiskPlan(plan, "Ceph")).toBe("Per-disk choices: bus disk 1->SCSI")
  })
})
