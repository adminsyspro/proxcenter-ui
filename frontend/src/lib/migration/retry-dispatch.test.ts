import { describe, expect, it } from "vitest"

import { persistedV2vInputs, resolveRetryEngine, resolveRetrySourceType, v2vConfigFromJobConfig } from "./retry-dispatch"

describe("resolveRetrySourceType", () => {
  it("prefers the persisted source type", () => {
    expect(resolveRetrySourceType({ sourceType: "hyperv" }, { type: "vmware", subType: "vcenter" })).toBe("hyperv")
  })

  it.each([
    [undefined, { type: "vmware", subType: "vcenter" }, "vcenter"],
    [undefined, { type: "hyperv" }, "hyperv"],
    [undefined, undefined, "vmware"],
  ])("resolves config %j and connection %j to %s", (config, connection, expected) => {
    expect(resolveRetrySourceType(config, connection)).toBe(expected)
  })
})

describe("resolveRetryEngine", () => {
  it.each([
    [{ sourceType: "xcpng", migrationType: "warm" }, undefined, "warm-xcpng"],
    [{ sourceType: "hyperv", migrationType: "warm" }, undefined, "warm-vmware"],
    [{ sourceType: "hyperv", migrationType: "cold" }, undefined, "v2v"],
    [{ sourceType: "vcenter", migrationType: "cold" }, undefined, "v2v"],
    [{ sourceType: "nutanix", migrationType: "cold" }, undefined, "v2v"],
    [{ sourceType: "xcpng", migrationType: "cold" }, undefined, "xcpng-cold"],
    [{ sourceType: "vmware", migrationType: "cold" }, undefined, "vmware"],
    [{ migrationType: "cold" }, null, "vmware"],
  ])("resolves %j with %j to %s", (config, connection, expected) => {
    expect(resolveRetryEngine(config, connection)).toBe(expected)
  })
})

describe("v2vConfigFromJobConfig", () => {
  const job = {
    sourceConnectionId: "job-source",
    sourceVmId: "job-vm",
    sourceVmName: "job-name",
    targetConnectionId: "job-target",
    targetNode: "job-node",
    targetStorage: "job-storage",
  }

  it("copies config fields and preserves live migration only for vCenter", () => {
    const result = v2vConfigFromJobConfig({
      sourceType: "vcenter",
      sourceConnectionId: "config-source",
      sourceVmId: "config-vm",
      sourceVmName: "config-name",
      targetConnectionId: "config-target",
      targetNode: "config-node",
      targetStorage: "config-storage",
      networkBridge: "vmbr1",
      vlanTag: 42,
      startAfterMigration: true,
      convertDisksToQcow2: true,
      diskPaths: ["/mnt/hyperv/a.vhdx"],
      tempStorage: "/scratch",
      vcenterDatacenter: "dc",
      vcenterCluster: "cluster",
      vcenterHost: "host",
      targetVmid: 123,
      v2vRoot: "/dev/sda2",
      migrationType: "live",
    }, job)

    expect(result).toEqual({
      sourceConnectionId: "config-source",
      sourceVmId: "config-vm",
      sourceVmName: "config-name",
      sourceType: "vcenter",
      targetConnectionId: "config-target",
      targetNode: "config-node",
      targetStorage: "config-storage",
      networkBridge: "vmbr1",
      vlanTag: 42,
      startAfterMigration: true,
      convertDisksToQcow2: true,
      vcenterDatacenter: "dc",
      vcenterCluster: "cluster",
      vcenterHost: "host",
      diskPaths: ["/mnt/hyperv/a.vhdx"],
      tempStorage: "/scratch",
      migrationType: "live",
      targetVmid: 123,
      v2vRoot: "/dev/sda2",
    })
  })

  it("falls back to job columns and forces Hyper-V live config to cold", () => {
    const result = v2vConfigFromJobConfig({ sourceType: "hyperv", migrationType: "live" }, job)

    expect(result).toMatchObject({
      sourceConnectionId: "job-source",
      sourceVmId: "job-vm",
      sourceVmName: "job-name",
      targetConnectionId: "job-target",
      targetNode: "job-node",
      targetStorage: "job-storage",
      sourceType: "hyperv",
      migrationType: "cold",
    })
    expect(result).not.toHaveProperty("targetVmid")
    expect(result).not.toHaveProperty("v2vRoot")
  })

  it("takes the source type from the live connection for a legacy job without sourceType", () => {
    const result = v2vConfigFromJobConfig({ migrationType: "cold" }, job, { type: "hyperv", subType: null })
    expect(result.sourceType).toBe("hyperv")

    const vcenter = v2vConfigFromJobConfig({ migrationType: "live" }, job, { type: "vmware", subType: "vcenter" })
    expect(vcenter).toMatchObject({ sourceType: "vcenter", migrationType: "live" })
  })
})

describe("persistedV2vInputs", () => {
  it("returns nothing for a body without virt-v2v inputs", () => {
    expect(persistedV2vInputs({}, undefined)).toEqual({})
  })

  it("keeps every provided input", () => {
    expect(persistedV2vInputs({
      diskPaths: ["/mnt/hyperv/Win2025/Virtual Hard Disks/Win2025.vhdx"],
      tempStorage: "/var/lib/vz",
      vcenterDatacenter: "DC1",
      vcenterCluster: "Prod",
      vcenterHost: "esx1.lab",
    }, "/dev/sda3")).toEqual({
      diskPaths: ["/mnt/hyperv/Win2025/Virtual Hard Disks/Win2025.vhdx"],
      tempStorage: "/var/lib/vz",
      vcenterDatacenter: "DC1",
      vcenterCluster: "Prod",
      vcenterHost: "esx1.lab",
      v2vRoot: "/dev/sda3",
    })
  })

  it("drops empty disk path lists, non-arrays and blank strings", () => {
    expect(persistedV2vInputs({ diskPaths: [], tempStorage: "", vcenterDatacenter: null, vcenterCluster: undefined, vcenterHost: 0 }, undefined)).toEqual({})
    expect(persistedV2vInputs({ diskPaths: "not-a-list" }, undefined)).toEqual({})
  })

  it("keeps an explicit empty root override but not an absent one", () => {
    expect(persistedV2vInputs({}, "")).toEqual({ v2vRoot: "" })
    expect(persistedV2vInputs({ tempStorage: "/tmp" }, undefined)).toEqual({ tempStorage: "/tmp" })
  })
})
