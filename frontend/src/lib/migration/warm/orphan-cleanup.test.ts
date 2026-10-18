import { beforeEach, describe, expect, it, vi } from "vitest"

import { prismaTest, truncate } from "@/__tests__/setup/prisma-test"

vi.mock("@/lib/db/prisma", async () => ({ prisma: (await import("@/__tests__/setup/prisma-test")).prismaTest }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "administrator@vsphere.local:pw") }))
vi.mock("@/lib/vmware/soap", () => ({
  soapLogin: vi.fn(async () => ({ s: 1 })), soapLogout: vi.fn(async () => {}),
  soapWaitForConsolidation: vi.fn(async () => true), soapConsolidateVmDisks: vi.fn(async () => {}),
}))
vi.mock("@/lib/vmware/cbt", () => ({ soapDisableCbt: vi.fn(async () => {}) }))
vi.mock("./warm-pipeline", () => ({ sweepWarmSnapshots: vi.fn(async () => 0) }))
vi.mock("./xcpng-warm-pipeline", () => ({ XCPNG_SNAPSHOT_PREFIX: "proxcenter-warm" }))
const xapi = vi.hoisted(() => ({
  xapiLogin: vi.fn(async () => ({ x: 1 })), xapiLogout: vi.fn(async () => {}),
  xapiVmRefByUuid: vi.fn(async () => "OpaqueRef:vm"),
  xapiFindSnapshotsByPrefix: vi.fn(async () => [] as string[]),
  xapiDestroySnapshot: vi.fn(async () => {}),
  xapiGetVmConfig: vi.fn(async () => ({ disks: [{ vdiRef: "OpaqueRef:vdi-a" }, { vdiRef: "OpaqueRef:vdi-b" }] })),
  xapiDisableCbt: vi.fn(async () => {}),
}))
vi.mock("@/lib/xcpng/xapi-client", () => xapi)
const node = vi.hoisted(() => ({ status: "status: stopped", mapped: "[]" as string }))
vi.mock("@/lib/ssh/exec", () => ({
  executeSSH: vi.fn(async (_c: string, _n: string, cmd: string) => ({ success: true, output: cmd.startsWith("qm status") ? node.status : node.mapped })),
}))
vi.mock("./finish", () => ({
  unmapTargetVolumes: vi.fn(async (_c: string, _n: string, vols: any[]) => { for (const v of vols) v.rbdMapped = false }),
}))
vi.mock("./orphan-readers", () => ({ sweepOrphanReaders: vi.fn(async () => ({ killed: [], kept: [] })) }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: vi.fn(async () => ({ baseUrl: "https://pve1:8006" })) }))
vi.mock("@/lib/migration/pve-tasks", () => ({ getNodeSshEndpointForMigration: vi.fn(async () => "10.42.0.101") }))

import { CBT_ENABLED_BY_RUN, CBT_ENABLED_BY_RUN_XCPNG, cleanupOrphanedWarmSource, cleanupOrphanedWarmSources, mappedTargetVolumesFromLog } from "./orphan-cleanup"
import { unmapTargetVolumes } from "./finish"
import { ORPHANED_JOB_ERROR } from "@/lib/migration/orphan-sweep"
import { soapConsolidateVmDisks, soapLogin, soapLogout, soapWaitForConsolidation } from "@/lib/vmware/soap"
import { soapDisableCbt } from "@/lib/vmware/cbt"
import { sweepWarmSnapshots } from "./warm-pipeline"
import { sweepOrphanReaders } from "./orphan-readers"
import { getConnectionById } from "@/lib/connections/getConnection"

const sweep = vi.mocked(sweepWarmSnapshots)
const readers = vi.mocked(sweepOrphanReaders)
const pveConn = vi.mocked(getConnectionById)
const disableCbt = vi.mocked(soapDisableCbt)
const login = vi.mocked(soapLogin)
const consolidationClear = vi.mocked(soapWaitForConsolidation)
const consolidate = vi.mocked(soapConsolidateVmDisks)

async function seed(over: Record<string, any> = {}) {
  await prismaTest.connection.upsert({
    where: { id: "vc" },
    update: {},
    create: { id: "vc", name: "vCenter", type: "vmware", subType: "vcenter", baseUrl: "https://vc.lab/", apiTokenEnc: "enc", insecureTLS: true },
  })
  return prismaTest.migrationJob.create({
    data: {
      sourceConnectionId: "vc", sourceVmId: "vm-42", targetConnectionId: "pve", targetNode: "pve1", targetStorage: "ceph",
      status: "failed", error: ORPHANED_JOB_ERROR, targetVmid: 111,
      config: { migrationType: "warm", sourceType: "vcenter" },
      logs: [{ ts: "2026-10-17T19:09:30.000Z", msg: CBT_ENABLED_BY_RUN, level: "success" }],
      ...over,
    },
  })
}

const logsOf = async (id: string) =>
  ((await prismaTest.migrationJob.findUniqueOrThrow({ where: { id } })).logs as Array<{ msg: string; level: string }>).map(l => l.msg)

beforeEach(async () => {
  await truncate(["migration_jobs", "Connection"])
  sweep.mockReset().mockResolvedValue(0)
  readers.mockReset().mockResolvedValue({ killed: [], kept: [] })
  pveConn.mockClear()
  vi.mocked(unmapTargetVolumes).mockClear()
  node.status = "status: stopped"
  node.mapped = "[]"
  disableCbt.mockReset().mockResolvedValue(undefined)
  login.mockClear()
  consolidationClear.mockReset().mockResolvedValue(true)
  consolidate.mockReset().mockResolvedValue(undefined)
  for (const f of Object.values(xapi)) f.mockClear()
  xapi.xapiFindSnapshotsByPrefix.mockResolvedValue([])
  xapi.xapiDestroySnapshot.mockResolvedValue(undefined)
  xapi.xapiDisableCbt.mockResolvedValue(undefined)
  vi.mocked(soapLogout).mockClear()
})

describe("cleanupOrphanedWarmSource", () => {
  it("removes the warm snapshots, switches back off the CBT the run enabled and points at the target VM", async () => {
    sweep.mockImplementationOnce(async (_s, _vm, log) => { await log('Removed leftover warm snapshot "proxcenter-warm-full" (snapshot-1) from the source VM'); return 1 })
    const job = await seed()

    await cleanupOrphanedWarmSource(job.id)

    expect(login).toHaveBeenCalledWith("https://vc.lab", "administrator@vsphere.local", "pw", true)
    expect(sweep).toHaveBeenCalledWith({ s: 1 }, "vm-42", expect.any(Function))
    expect(disableCbt).toHaveBeenCalledWith({ s: 1 }, "vm-42")
    expect(soapLogout).toHaveBeenCalled()
    const logs = await logsOf(job.id)
    expect(logs).toEqual(expect.arrayContaining([
      expect.stringContaining("Target VM 111 on pve1 was left"),
      expect.stringContaining("proxcenter-warm-full"),
      "CBT disabled on source again (it was off before the migration)",
    ]))
  })

  it("consolidates the source disks when vSphere still flags a pending merge", async () => {
    consolidationClear.mockResolvedValueOnce(false)
    const job = await seed()

    await cleanupOrphanedWarmSource(job.id)

    expect(consolidationClear).toHaveBeenCalledWith({ s: 1 }, "vm-42", 0, 0)
    expect(consolidate).toHaveBeenCalledWith({ s: 1 }, "vm-42", expect.objectContaining({ timeoutMs: expect.any(Number) }))
    expect(await logsOf(job.id)).toEqual(expect.arrayContaining([expect.stringContaining("Consolidated the source VM disks")]))
  })

  it("says how to finish by hand when the consolidation fails", async () => {
    consolidationClear.mockResolvedValueOnce(false)
    consolidate.mockRejectedValueOnce(new Error("locked"))
    const job = await seed()

    await cleanupOrphanedWarmSource(job.id)

    expect(await logsOf(job.id)).toEqual(expect.arrayContaining([expect.stringContaining('Could not consolidate the source VM disks (locked): run "Consolidate"')]))
  })

  it("stops the run's copy reader on the target node before touching the snapshot", async () => {
    const order: string[] = []
    readers.mockImplementationOnce(async (a: any) => { order.push("readers"); await a.log("Stopped 1 leftover nbdkit reader(s)", "warn"); return { killed: [], kept: [] } })
    sweep.mockImplementationOnce(async () => { order.push("snapshots"); return 0 })
    const job = await seed()

    await cleanupOrphanedWarmSource(job.id)

    expect(pveConn).toHaveBeenCalledWith("pve", "default")
    expect(readers).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "pve", nodeIp: "10.42.0.101", nodeName: "pve1", currentJobId: "" }))
    expect(order).toEqual(["readers", "snapshots"])
    expect(await logsOf(job.id)).toContain("Stopped 1 leftover nbdkit reader(s)")
  })

  it("still cleans the source when the target node cannot be reached", async () => {
    pveConn.mockRejectedValueOnce(new Error("Connection not found: pve"))
    const job = await seed()

    await cleanupOrphanedWarmSource(job.id)

    expect(sweep).toHaveBeenCalled()
    expect(await logsOf(job.id)).toEqual(expect.arrayContaining([expect.stringContaining("Could not stop the copy reader of this run on pve1")]))
  })

  it("leaves a CBT the run found already on", async () => {
    const job = await seed({ logs: [{ ts: "x", msg: "CBT already enabled on source, left as is", level: "info" }] })

    await cleanupOrphanedWarmSource(job.id)

    expect(sweep).toHaveBeenCalled()
    expect(disableCbt).not.toHaveBeenCalled()
    expect(consolidate).not.toHaveBeenCalled()
    expect(await logsOf(job.id)).toContain("No warm snapshot left on the source VM after the restart")
  })

  it.each([
    ["a cold job", { config: { migrationType: "cold", sourceType: "vcenter" } }],
    ["an XCP-ng warm job", { config: { migrationType: "warm", sourceType: "xcpng" } }],
    ["a job failed for another reason", { error: "disk full" }],
    ["a job that is not failed", { status: "completed", error: null }],
  ])("does nothing for %s", async (_label, over) => {
    const job = await seed(over)

    await cleanupOrphanedWarmSource(job.id)

    expect(login).not.toHaveBeenCalled()
  })

  it("keeps away from a source a newer run is already working on", async () => {
    const job = await seed()
    await seed({ status: "full_copy", error: null, logs: [] })

    await cleanupOrphanedWarmSource(job.id)

    expect(login).not.toHaveBeenCalled()
    expect(await logsOf(job.id)).toEqual(expect.arrayContaining([expect.stringContaining("Target VM 111")]))
  })

  it("never throws and says what to do when vSphere is unreachable", async () => {
    login.mockRejectedValueOnce(new Error("ECONNREFUSED"))
    const job = await seed()

    await expect(cleanupOrphanedWarmSource(job.id)).resolves.toBeUndefined()

    expect(await logsOf(job.id)).toEqual(expect.arrayContaining([expect.stringContaining("Could not clean the source VM after the restart (ECONNREFUSED)")]))
  })

  it("logs a CBT it could not switch off", async () => {
    disableCbt.mockRejectedValueOnce(new Error("task failed"))
    const job = await seed()

    await cleanupOrphanedWarmSource(job.id)

    expect(await logsOf(job.id)).toEqual(expect.arrayContaining([expect.stringContaining("Could not disable CBT on the source again: task failed")]))
  })

  it("handles every swept job", async () => {
    const a = await seed()
    const b = await seed({ sourceVmId: "vm-43" })

    await cleanupOrphanedWarmSources([a.id, b.id, "gone"])

    expect(sweep).toHaveBeenCalledTimes(2)
  })

  describe("XCP-ng warm", () => {
    async function seedXcp(over: Record<string, any> = {}) {
      await prismaTest.connection.upsert({
        where: { id: "xcp" },
        update: {},
        create: { id: "xcp", name: "pool", type: "xcpng", subType: "xapi", baseUrl: "https://xcp.lab", apiTokenEnc: "enc", insecureTLS: true } as any,
      })
      return seed({
        sourceConnectionId: "xcp", sourceVmId: "uuid-vm",
        config: { migrationType: "warm", sourceType: "xcpng" },
        logs: [{ ts: "x", msg: CBT_ENABLED_BY_RUN_XCPNG, level: "success" }],
        ...over,
      })
    }

    it("stops the reader, removes the warm snapshots and their disks, switches CBT back off, keeps the target VM", async () => {
      xapi.xapiFindSnapshotsByPrefix.mockResolvedValueOnce(["OpaqueRef:snap-1"])
      const job = await seedXcp()

      await cleanupOrphanedWarmSource(job.id)

      expect(readers).toHaveBeenCalled()
      expect(xapi.xapiLogin).toHaveBeenCalledWith("https://xcp.lab", "administrator@vsphere.local", "pw", true)
      expect(xapi.xapiFindSnapshotsByPrefix).toHaveBeenCalledWith({ x: 1 }, "OpaqueRef:vm", "proxcenter-warm-")
      expect(xapi.xapiDestroySnapshot).toHaveBeenCalledWith({ x: 1 }, "OpaqueRef:snap-1")
      expect(xapi.xapiDisableCbt.mock.calls.map(c => c[1])).toEqual(["OpaqueRef:vdi-a", "OpaqueRef:vdi-b"])
      expect(xapi.xapiLogout).toHaveBeenCalled()
      expect(login).not.toHaveBeenCalled()
      expect(await logsOf(job.id)).toEqual(expect.arrayContaining([
        expect.stringContaining("Target VM 111 on pve1 was left"),
        "Removed leftover warm snapshot OpaqueRef:snap-1 and its disks from the source VM",
        "CBT disabled on the source disks again (it was off before the migration)",
      ]))
    })

    it("leaves CBT alone when the run found it already on for some disks, and says so", async () => {
      const job = await seedXcp({ logs: [{ ts: "x", msg: "CBT enabled on 1 of 2 source disk(s), already on for the others (left as is)", level: "success" }] })

      await cleanupOrphanedWarmSource(job.id)

      expect(xapi.xapiDisableCbt).not.toHaveBeenCalled()
      expect(await logsOf(job.id)).toEqual(expect.arrayContaining([
        "No warm snapshot left on the source VM after the restart",
        expect.stringContaining("for some source disks only and stays on"),
      ]))
    })

    it("names a snapshot it could not remove and a CBT it could not switch off", async () => {
      xapi.xapiFindSnapshotsByPrefix.mockResolvedValueOnce(["OpaqueRef:snap-1"])
      xapi.xapiDestroySnapshot.mockRejectedValueOnce(new Error("VDI_IN_USE"))
      xapi.xapiDisableCbt.mockRejectedValueOnce(new Error("boom"))
      const job = await seedXcp()

      await cleanupOrphanedWarmSource(job.id)

      expect(await logsOf(job.id)).toEqual(expect.arrayContaining([
        "Could not remove warm snapshot OpaqueRef:snap-1 (VDI_IN_USE); delete it on the XCP-ng pool",
        expect.stringContaining("Could not disable CBT on 1 source disk(s) again"),
      ]))
    })

    it("says where to finish by hand when the pool is unreachable", async () => {
      xapi.xapiLogin.mockRejectedValueOnce(new Error("ECONNREFUSED"))
      const job = await seedXcp()

      await cleanupOrphanedWarmSource(job.id)

      expect(await logsOf(job.id)).toEqual(expect.arrayContaining([expect.stringContaining("remove any proxcenter-warm-* snapshot from it in the XCP-ng pool")]))
    })
  })

  describe("RBD mappings of the target", () => {
    const mapLog = (dev: string, vol = "CephStoragePool:vm-111-disk-0") => ({ ts: "x", msg: `Disk 0: target ${vol} → ${dev} (3.0 GB)`, level: "info" })
    const withMapping = (over: Record<string, any> = {}) => seed({ logs: [{ ts: "x", msg: CBT_ENABLED_BY_RUN, level: "success" }, mapLog("/dev/rbd3")], ...over })

    it("reads the devices the run mapped from its log", () => {
      expect(mappedTargetVolumesFromLog([mapLog("/dev/rbd3"), { msg: "Full copy…" }, mapLog("/dev/rbd4", "ceph:vm-111-disk-1")])).toEqual([
        { volumeId: "CephStoragePool:vm-111-disk-0", devicePath: "/dev/rbd3", rbdMapped: true },
        { volumeId: "ceph:vm-111-disk-1", devicePath: "/dev/rbd4", rbdMapped: true },
      ])
      expect(mappedTargetVolumesFromLog(null)).toEqual([])
    })

    it("releases the mappings of a stopped target VM with the engine helper, and says so", async () => {
      node.mapped = JSON.stringify([{ name: "vm-111-disk-0", device: "/dev/rbd3" }, { name: "vm-200-disk-0", device: "/dev/rbd5" }])
      const job = await withMapping()

      await cleanupOrphanedWarmSource(job.id)

      expect(unmapTargetVolumes).toHaveBeenCalledWith("pve", "10.42.0.101", [expect.objectContaining({ devicePath: "/dev/rbd3", volumeId: "CephStoragePool:vm-111-disk-0" })])
      expect(await logsOf(job.id)).toContain("Released the RBD mapping(s) of target VM 111 on pve1: /dev/rbd3 (CephStoragePool:vm-111-disk-0)")
    })

    it("never touches the mappings of a running target VM", async () => {
      node.status = "status: running"
      node.mapped = JSON.stringify([{ name: "vm-111-disk-0", device: "/dev/rbd3" }])
      const job = await withMapping()

      await cleanupOrphanedWarmSource(job.id)

      expect(unmapTargetVolumes).not.toHaveBeenCalled()
      expect(await logsOf(job.id)).toContain("Target VM 111 is running: its RBD mappings on pve1 are left alone")
    })

    it("leaves a device the node now maps to another image", async () => {
      node.mapped = JSON.stringify([{ name: "vm-200-disk-0", device: "/dev/rbd3" }])
      const job = await withMapping()

      await cleanupOrphanedWarmSource(job.id)

      expect(unmapTargetVolumes).not.toHaveBeenCalled()
    })

    it("says which device it could not release", async () => {
      vi.mocked(unmapTargetVolumes).mockImplementationOnce(async () => {})
      node.mapped = JSON.stringify([{ name: "vm-111-disk-0", device: "/dev/rbd3" }])
      const job = await withMapping()

      await cleanupOrphanedWarmSource(job.id)

      expect(await logsOf(job.id)).toEqual(expect.arrayContaining([expect.stringContaining('Could not release /dev/rbd3 on pve1')]))
    })

    it("does nothing without a mapping in the log or a target VM", async () => {
      const job = await seed({ targetVmid: null, logs: [mapLog("/dev/rbd3")] })

      await cleanupOrphanedWarmSource(job.id)

      expect(unmapTargetVolumes).not.toHaveBeenCalled()
    })
  })
})
