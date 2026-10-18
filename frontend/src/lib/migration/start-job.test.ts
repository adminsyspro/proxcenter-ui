import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  connection: { findUnique: vi.fn() },
}))

vi.mock("@/lib/tenant", () => ({ getTenantPrisma: vi.fn(() => ({ connection: h.connection })) }))
vi.mock("@/lib/migration/pipeline", () => ({ runMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/xcpng-pipeline", () => ({ runXcpngMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/v2v-pipeline", () => ({ runV2vMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/warm/warm-pipeline", () => ({ runWarmMigration: vi.fn() }))
vi.mock("@/lib/migration/warm/xcpng-warm-pipeline", () => ({ runXcpngWarmMigration: vi.fn() }))
vi.mock("@/lib/vmware/soap", () => ({
  soapLogin: vi.fn(async () => ({})), soapLogout: vi.fn(async () => {}),
  soapGetVmConfig: vi.fn(async () => "<xml/>"), parseVmConfig: vi.fn(),
}))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "root:pass") }))

import { coldConfigFromJobConfig, startMigrationJob, warmConfigFromJobConfig } from "./start-job"
import { runMigrationPipeline } from "@/lib/migration/pipeline"
import { runXcpngMigrationPipeline } from "@/lib/migration/xcpng-pipeline"
import { runV2vMigrationPipeline } from "@/lib/migration/v2v-pipeline"
import { runWarmMigration } from "@/lib/migration/warm/warm-pipeline"
import { runXcpngWarmMigration } from "@/lib/migration/warm/xcpng-warm-pipeline"
import { parseVmConfig } from "@/lib/vmware/soap"

const cold = vi.mocked(runMigrationPipeline)
const xcpngCold = vi.mocked(runXcpngMigrationPipeline)
const v2v = vi.mocked(runV2vMigrationPipeline)
const warm = vi.mocked(runWarmMigration)
const xcpngWarm = vi.mocked(runXcpngWarmMigration)
const parse = vi.mocked(parseVmConfig)

const base = {
  sourceConnectionId: "src", sourceVmId: "vm-1", sourceVmName: "web-1", targetConnectionId: "tgt",
  targetNode: "pve1", targetStorage: "local-lvm", networkBridge: "vmbr0", startAfterMigration: false,
  convertDisksToQcow2: false, cpuType: "host", transferMode: "auto",
}
const job = (config: Record<string, unknown>) => ({
  id: "job-1", sourceConnectionId: "src", sourceVmId: "vm-1", sourceVmName: "web-1",
  targetConnectionId: "tgt", targetNode: "pve1", targetStorage: "local-lvm", config,
})

beforeEach(() => {
  for (const m of [cold, xcpngCold, v2v, warm, xcpngWarm]) m.mockReset()
  h.connection.findUnique.mockReset()
  parse.mockReset()
})

describe("startMigrationJob", () => {
  it("routes a VMware warm job to the VMware warm engine with every warm option", async () => {
    const config = { ...base, migrationType: "warm", sourceType: "vcenter", downtimeBudgetSec: 600, cutoverMode: "manual", zeroRateLimitMBps: 200, copyVmk: "vmk2", copyAddress: "10.0.0.2", vddkLibdir: "/opt/vddk", targetVmid: 900, hardware: { cores: 2 }, nics: [{ index: 0, bridge: "vmbr1" }] }

    await startMigrationJob(job(config), "t1")

    expect(warm).toHaveBeenCalledWith("job-1", {
      sourceConnectionId: "src", sourceVmId: "vm-1", targetConnectionId: "tgt", targetNode: "pve1", targetStorage: "local-lvm",
      networkBridge: "vmbr0", vlanTag: undefined, startAfterMigration: false, convertDisksToQcow2: false, cpuType: "host",
      hardware: { cores: 2 }, nics: [{ index: 0, bridge: "vmbr1" }], targetVmid: 900, vddkLibdir: "/opt/vddk",
      downtimeBudgetSec: 600, cutoverMode: "manual", zeroRateLimitMBps: 200, copyVmk: "vmk2", copyAddress: "10.0.0.2",
    }, "t1")
    expect(cold).not.toHaveBeenCalled()
    expect(h.connection.findUnique).not.toHaveBeenCalled()
  })

  it("routes an XCP-ng warm job to the XCP-ng engine without the VMware-only options", async () => {
    await startMigrationJob(job({ ...base, migrationType: "warm", sourceType: "xcpng", vddkLibdir: "/x", copyVmk: "vmk1", copyAddress: "a" }), "t1")

    const cfg = xcpngWarm.mock.calls[0][1]
    expect(cfg).toMatchObject({ sourceVmId: "vm-1", targetNode: "pve1" })
    expect(cfg).not.toHaveProperty("vddkLibdir")
    expect(cfg).not.toHaveProperty("copyVmk")
    expect(warm).not.toHaveBeenCalled()
  })

  it("routes vCenter cold and live jobs to virt-v2v", async () => {
    await startMigrationJob(job({ ...base, migrationType: "live", sourceType: "vcenter", vcenterDatacenter: "DC" }), "t1")

    expect(v2v).toHaveBeenCalledWith("job-1", expect.objectContaining({ sourceType: "vcenter", migrationType: "live", vcenterDatacenter: "DC" }), "t1")
  })

  it("routes an offline XCP-ng job to the XCP-ng pipeline, forced cold", async () => {
    await startMigrationJob(job({ ...base, migrationType: "cold", sourceType: "xcpng", tempStorage: "/var/tmp" }), "t1")

    expect(xcpngCold).toHaveBeenCalledWith("job-1", expect.objectContaining({ migrationType: "cold", tempStorage: "/var/tmp" }), "t1")
  })

  it("sends a Windows guest of a direct-ESXi cold job through virt-v2v", async () => {
    h.connection.findUnique.mockResolvedValueOnce({ apiTokenEnc: "enc", baseUrl: "https://esxi1.lab/", insecureTLS: true, sshEnabled: true, sshKeyEnc: "k", sshPassEnc: null })
    parse.mockReturnValueOnce({ guestOS: "Microsoft Windows Server 2022", guestId: "windows2019srv_64Guest", vmPathName: "[Datastore] win/win.vmx" } as any)

    await startMigrationJob(job({ ...base, migrationType: "cold", sourceType: "vmware", v2vRoot: "/dev/sda2" }), "t1")

    expect(v2v).toHaveBeenCalledWith("job-1", expect.objectContaining({
      sourceType: "esxi-direct", vmxPath: "/vmfs/volumes/Datastore/win/win.vmx", esxiHost: "esxi1.lab", migrationType: "cold", v2vRoot: "/dev/sda2", sourceVmName: "web-1",
    }), "t1")
    expect(cold).not.toHaveBeenCalled()
  })

  it("keeps a Linux guest of a direct-ESXi cold job on the in-house pipeline", async () => {
    h.connection.findUnique.mockResolvedValueOnce({ apiTokenEnc: "enc", baseUrl: "https://esxi1.lab", insecureTLS: true, sshEnabled: true, sshKeyEnc: "k" })
    parse.mockReturnValueOnce({ guestOS: "Debian GNU/Linux 12", guestId: "debian12_64Guest", vmPathName: "[Datastore] deb/deb.vmx" } as any)

    await startMigrationJob(job({ ...base, migrationType: "cold", sourceType: "vmware" }), "t1")

    expect(cold).toHaveBeenCalledWith("job-1", expect.objectContaining({ migrationType: "cold", transferMode: "auto" }), "t1")
    expect(v2v).not.toHaveBeenCalled()
  })

  it("falls back to the in-house pipeline when the routing lookup fails", async () => {
    h.connection.findUnique.mockRejectedValueOnce(new Error("db down"))

    await startMigrationJob(job({ ...base, migrationType: "cold", sourceType: "vmware" }), "t1")

    expect(cold).toHaveBeenCalledOnce()
  })

  it("does not look the guest up for a live or SSHFS-boot ESXi job", async () => {
    await startMigrationJob(job({ ...base, migrationType: "sshfs_boot", sourceType: "vmware" }), "t1")

    expect(cold).toHaveBeenCalledWith("job-1", expect.objectContaining({ migrationType: "sshfs_boot" }), "t1")
    expect(h.connection.findUnique).not.toHaveBeenCalled()
  })

  it("reads the source connection for a config saved before sourceType existed", async () => {
    h.connection.findUnique.mockResolvedValueOnce({ type: "hyperv", subType: null })

    await startMigrationJob(job({ ...base, migrationType: "cold" }), "t1")

    expect(v2v).toHaveBeenCalledWith("job-1", expect.objectContaining({ sourceType: "hyperv" }), "t1")
  })

  it("uses the connection the caller already has", async () => {
    await startMigrationJob(job({ ...base, migrationType: "cold" }), "t1", { type: "xcpng", subType: "xapi" })

    expect(xcpngCold).toHaveBeenCalledOnce()
    expect(h.connection.findUnique).not.toHaveBeenCalled()
  })
})

describe("config builders", () => {
  it("omit absent options", () => {
    const w = warmConfigFromJobConfig({ ...base }, "warm-vmware")
    for (const k of ["targetVmid", "vddkLibdir", "downtimeBudgetSec", "cutoverMode", "zeroRateLimitMBps", "copyVmk", "hardware", "nics"]) {
      expect(w).not.toHaveProperty(k)
    }
    const c = coldConfigFromJobConfig({ ...base, migrationType: "cold" })
    expect(c).not.toHaveProperty("tempStorage")
    expect(c).not.toHaveProperty("targetVmid")
  })
})
