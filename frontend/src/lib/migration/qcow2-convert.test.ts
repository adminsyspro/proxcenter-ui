import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))
vi.mock("./pve-tasks", () => ({ waitForPveTask: vi.fn() }))

import { pveFetch } from "@/lib/proxmox/client"
import { waitForPveTask } from "./pve-tasks"
import {
  convertDisksToQcow2, storageDefaultsToQcow2, migratedDataDisks, MOVE_DISK_TIMEOUT_MS,
} from "./qcow2-convert"
import type { AllocatedVolume } from "./pvesm-alloc"

const mockFetch = vi.mocked(pveFetch)
const mockWait = vi.mocked(waitForPveTask)

const conn = { baseUrl: "https://pve.example:8006", apiToken: "t", insecureDev: false, id: "c1" }
const NODE = "pve1"
const VMID = 250
const STORAGE = "FC-HDC-01"
const GiB = 1024 ** 3

// A PVE 9 LVM storage with snapshot-as-volume-chain: the only storage class
// whose default format is qcow2 (what the whole feature exists for, #595).
const QUALIFYING_STORAGE = { storage: STORAGE, type: "lvm", "snapshot-as-volume-chain": 1 }

function makeVolumes(): AllocatedVolume[] {
  return [
    { volumeId: `${STORAGE}:vm-250-disk-1`, devicePath: "/dev/vg/vm-250-disk-1", attached: true, copied: true },
    { volumeId: `${STORAGE}:vm-250-disk-2`, devicePath: "/dev/vg/vm-250-disk-2", attached: true, copied: true },
  ]
}

// VM config after a migration: our two data disks, plus an efidisk that is
// already qcow2 (created by qm create, never ours to convert — #606) and keys
// that are not disks at all.
function baseVmConf(): Record<string, string> {
  return {
    scsi0: `${STORAGE}:vm-250-disk-1,size=32G`,
    scsi1: `${STORAGE}:vm-250-disk-2,size=100G`,
    efidisk0: `${STORAGE}:vm-250-disk-0.qcow2,efitype=4m,size=4M`,
    net0: "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0",
    name: "web01",
    boot: "order=scsi0",
  }
}

function makeHarness(volumes: AllocatedVolume[] = makeVolumes(), overrides: Record<string, unknown> = {}) {
  const logs: Array<{ msg: string; level: string }> = []
  const phases: number[] = []
  const args = {
    enabled: true,
    conn,
    node: NODE,
    vmid: VMID,
    targetStorage: STORAGE,
    volumes,
    log: (msg: string, level = "info") => { logs.push({ msg, level }) },
    setPhase: (progress: number) => { phases.push(progress) },
    ...overrides,
  }
  return { logs, phases, args: args as Parameters<typeof convertDisksToQcow2>[0] }
}

/**
 * Wire the pveFetch mock like a live PVE node: storage config, storage status,
 * VM config, and a move_disk endpoint that renames the slot's volume to a fresh
 * .qcow2 name (exactly what PVE does: mirror into a new volume, delete the raw
 * one) unless `onMove` overrides it.
 */
function mockPveRoutes(opts: {
  storageCfg?: unknown
  avail?: number
  conf?: Record<string, string>
  onMove?: (body: URLSearchParams) => string | Promise<string>
} = {}) {
  const conf = opts.conf ?? baseVmConf()
  let nextDisk = 3
  mockFetch.mockImplementation(async (_c: any, path: string, init?: any) => {
    if (path === `/storage/${STORAGE}`) return opts.storageCfg === undefined ? QUALIFYING_STORAGE : opts.storageCfg
    if (path === `/nodes/${NODE}/storage/${STORAGE}/status`) {
      return { avail: opts.avail ?? 500 * GiB, total: 1000 * GiB, used: 500 * GiB }
    }
    if (path === `/nodes/${NODE}/qemu/${VMID}/config`) return { ...conf }
    if (path === `/nodes/${NODE}/qemu/${VMID}/move_disk`) {
      const body = init.body as URLSearchParams
      if (opts.onMove) return opts.onMove(body)
      const slot = body.get("disk")!
      const size = String(conf[slot]).split("size=")[1]
      conf[slot] = `${STORAGE}:vm-${VMID}-disk-${nextDisk++}.qcow2,size=${size}`
      return `UPID:${slot}`
    }
    throw new Error(`unexpected pveFetch ${path}`)
  })
  return conf
}

function moveCalls() {
  return mockFetch.mock.calls.filter(c => String(c[1]).endsWith("/move_disk"))
}

beforeEach(() => {
  mockFetch.mockReset()
  mockWait.mockReset().mockResolvedValue(undefined)
})

describe("convertDisksToQcow2 — success path", () => {
  it("issues the exact move_disk call the web UI makes, one per data disk, and waits for each task", async () => {
    mockPveRoutes()
    const { args, logs } = makeHarness()

    await convertDisksToQcow2(args)

    const calls = moveCalls()
    expect(calls).toHaveLength(2)
    expect(calls[0][2]?.method).toBe("POST")
    expect(Object.fromEntries(calls[0][2]!.body as URLSearchParams)).toEqual({
      disk: "scsi0", storage: STORAGE, format: "qcow2", delete: "1",
    })
    expect(Object.fromEntries(calls[1][2]!.body as URLSearchParams)).toEqual({
      disk: "scsi1", storage: STORAGE, format: "qcow2", delete: "1",
    })
    // one UPID wait per disk, under the generous multi-TB timeout
    expect(mockWait).toHaveBeenCalledTimes(2)
    expect(mockWait).toHaveBeenNthCalledWith(1, conn, NODE, "UPID:scsi0", MOVE_DISK_TIMEOUT_MS)
    expect(mockWait).toHaveBeenNthCalledWith(2, conn, NODE, "UPID:scsi1", MOVE_DISK_TIMEOUT_MS)
    expect(logs.some(l => l.level === "success" && /snapshot/i.test(l.msg))).toBe(true)
  })

  it("reports its own converting_disks phase from 95 to 99", async () => {
    mockPveRoutes()
    const { args, phases } = makeHarness()

    await convertDisksToQcow2(args)

    expect(phases[0]).toBe(95)
    expect(phases[phases.length - 1]).toBe(99)
    // monotonic: a job log reader never sees progress move backwards
    for (let i = 1; i < phases.length; i++) expect(phases[i]).toBeGreaterThanOrEqual(phases[i - 1])
  })

  it("rewrites the cleanup registry with the new qcow2 volume ids (#595 point 7: the raw volume is gone)", async () => {
    mockPveRoutes()
    const volumes = makeVolumes()
    const { args } = makeHarness(volumes)

    await convertDisksToQcow2(args)

    // PVE mirrored into a fresh volume and deleted the raw one: a later cleanup
    // freeing the old name would hit a volume that no longer exists.
    expect(volumes[0].volumeId).toBe(`${STORAGE}:vm-250-disk-3.qcow2`)
    expect(volumes[1].volumeId).toBe(`${STORAGE}:vm-250-disk-4.qcow2`)
    // the raw LV's device path died with it
    expect(volumes[0].devicePath).toBe("")
    expect(volumes[0].attached).toBe(true)
  })

  it("only converts the disks this migration created — never the efidisk, never someone else's disk", async () => {
    const conf = baseVmConf()
    conf.scsi2 = `${STORAGE}:vm-250-disk-9,size=10G` // attached by an operator, not ours
    mockPveRoutes({ conf })
    const { args } = makeHarness()

    await convertDisksToQcow2(args)

    const slots = moveCalls().map(c => (c[2]!.body as URLSearchParams).get("disk"))
    expect(slots).toEqual(["scsi0", "scsi1"])
  })
})

describe("convertDisksToQcow2 — skip paths (each with an explanatory log line)", () => {
  it("does nothing at all when the option is off", async () => {
    const { args, logs, phases } = makeHarness(makeVolumes(), { enabled: false })

    await convertDisksToQcow2(args)

    expect(mockFetch).not.toHaveBeenCalled()
    expect(phases).toEqual([])
    // Silent: every pipeline calls the helper unconditionally, so a skip line
    // here would pollute the log of every migration that never opted in.
    expect(logs).toEqual([])
  })

  it.each([
    ["lvm without snapshot-as-volume-chain", { type: "lvm" }],
    ["lvmthin (qcow2-on-lvmthin is not a thing)", { type: "lvmthin", "snapshot-as-volume-chain": 1 }],
    ["zfspool (snapshots natively, raw is right)", { type: "zfspool" }],
  ])("skips when the storage does not default to qcow2: %s", async (_label, storageCfg) => {
    mockPveRoutes({ storageCfg: { storage: STORAGE, ...storageCfg } })
    const { args, logs, phases } = makeHarness()

    await convertDisksToQcow2(args)

    expect(moveCalls()).toHaveLength(0)
    expect(phases).toEqual([])
    expect(logs.some(l => l.msg.includes(STORAGE))).toBe(true)
  })

  it("skips when free space is below the largest disk (the mirror transiently needs a second full copy)", async () => {
    mockPveRoutes({ avail: 50 * GiB }) // largest disk is 100G
    const { args, logs } = makeHarness()

    await convertDisksToQcow2(args)

    expect(moveCalls()).toHaveLength(0)
    expect(logs.some(l => l.level === "warn" && /free space/i.test(l.msg))).toBe(true)
  })

  it("skips when none of our volumes is attached to the VM (nothing to convert)", async () => {
    mockPveRoutes()
    const volumes: AllocatedVolume[] = [{ volumeId: `${STORAGE}:vm-250-disk-7`, devicePath: "/dev/vg/x" }]
    const { args, logs } = makeHarness(volumes)

    await convertDisksToQcow2(args)

    expect(moveCalls()).toHaveLength(0)
    expect(logs.length).toBeGreaterThan(0)
  })
})

describe("convertDisksToQcow2 — can never fail the migration (#595 design point 3)", () => {
  // Resolving (never rejecting) is the property that lets every pipeline's very
  // next statement — updateJob(jobId, "completed") — run whatever happened here.
  const warnAbout = (logs: Array<{ msg: string; level: string }>) =>
    logs.filter(l => l.level === "warn").map(l => l.msg).join("\n")

  it("a move_disk refusal (API error) resolves, warns, and stops converting", async () => {
    mockPveRoutes({ onMove: () => { throw new Error("400 Parameter verification failed") } })
    const { args, logs } = makeHarness()

    await expect(convertDisksToQcow2(args)).resolves.toBeUndefined()

    expect(moveCalls()).toHaveLength(1) // first disk refused -> do not hammer the second
    expect(warnAbout(logs)).toMatch(/migrated and usable/i)
    expect(warnAbout(logs)).toMatch(/still raw/i)
  })

  it("a failed PVE task resolves, warns, and leaves the bookkeeping untouched", async () => {
    mockPveRoutes()
    mockWait.mockRejectedValue(new Error("PVE task failed: lvcreate 'vg/vm-250-disk-3.qcow2' error: not enough extents"))
    const volumes = makeVolumes()
    const { args, logs } = makeHarness(volumes)

    await expect(convertDisksToQcow2(args)).resolves.toBeUndefined()

    expect(warnAbout(logs)).toMatch(/still raw/i)
    // the move failed: the raw volume is still the attached one, keep its id
    expect(volumes[0].volumeId).toBe(`${STORAGE}:vm-250-disk-1`)
  })

  it("a task timeout resolves and warns", async () => {
    mockPveRoutes()
    mockWait.mockRejectedValue(new Error("PVE task timed out after 86400s"))
    const { args, logs } = makeHarness()

    await expect(convertDisksToQcow2(args)).resolves.toBeUndefined()
    expect(warnAbout(logs)).toMatch(/still raw/i)
  })

  it("even the server-side gate blowing up resolves and warns", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"))
    const { args, logs } = makeHarness()

    await expect(convertDisksToQcow2(args)).resolves.toBeUndefined()
    expect(warnAbout(logs)).toMatch(/still raw/i)
  })

  it("a throwing log callback still resolves (nothing may reach the pipeline's catch)", async () => {
    mockPveRoutes({ onMove: () => { throw new Error("boom") } })
    const { args } = makeHarness(makeVolumes(), {
      log: () => { throw new Error("logs JSONB write failed") },
    })

    await expect(convertDisksToQcow2(args)).resolves.toBeUndefined()
  })
})

describe("storageDefaultsToQcow2", () => {
  it("accepts an lvm storage with snapshot-as-volume-chain (number or string flag)", () => {
    expect(storageDefaultsToQcow2({ type: "lvm", "snapshot-as-volume-chain": 1 })).toBe(true)
    expect(storageDefaultsToQcow2({ type: "lvm", "snapshot-as-volume-chain": "1" })).toBe(true)
  })

  it("rejects everything else", () => {
    expect(storageDefaultsToQcow2({ type: "lvm" })).toBe(false)
    expect(storageDefaultsToQcow2({ type: "lvm", "snapshot-as-volume-chain": 0 })).toBe(false)
    expect(storageDefaultsToQcow2({ type: "lvmthin", "snapshot-as-volume-chain": 1 })).toBe(false)
    expect(storageDefaultsToQcow2({ type: "zfspool" })).toBe(false)
    expect(storageDefaultsToQcow2({ type: "rbd" })).toBe(false)
    expect(storageDefaultsToQcow2(null)).toBe(false)
    expect(storageDefaultsToQcow2(undefined)).toBe(false)
  })
})

describe("migratedDataDisks", () => {
  const ours = [{ volumeId: `${STORAGE}:vm-250-disk-1` }, { volumeId: `${STORAGE}:vm-250-disk-2` }]

  it("maps our attached volumes to their slots with byte sizes parsed from the config value", () => {
    expect(migratedDataDisks(baseVmConf(), ours)).toEqual([
      { slot: "scsi0", volumeId: `${STORAGE}:vm-250-disk-1`, sizeBytes: 32 * GiB },
      { slot: "scsi1", volumeId: `${STORAGE}:vm-250-disk-2`, sizeBytes: 100 * GiB },
    ])
  })

  it("understands M/T suffixes and plain byte counts", () => {
    const conf = {
      scsi0: `${STORAGE}:vm-250-disk-1,size=4400M`,
      virtio1: `${STORAGE}:vm-250-disk-2,size=1T`,
      sata2: `${STORAGE}:vm-250-disk-3,size=10737418240`,
    }
    const vols = [...ours, { volumeId: `${STORAGE}:vm-250-disk-3` }]
    // natural slot order: sata2 < scsi0 < virtio1
    expect(migratedDataDisks(conf, vols).map(d => d.sizeBytes)).toEqual([
      10737418240, 4400 * 1024 ** 2, 1024 ** 4,
    ])
  })

  it("never returns the efidisk, unused slots, or volumes we did not create", () => {
    const conf = {
      ...baseVmConf(),
      tpmstate0: `${STORAGE}:vm-250-disk-5,size=4M`,
      unused0: `${STORAGE}:vm-250-disk-1`,
      scsi3: `other-storage:vm-250-disk-1,size=5G`,
    }
    const slots = migratedDataDisks(conf, ours).map(d => d.slot)
    expect(slots).toEqual(["scsi0", "scsi1"])
  })

  it("skips a volume that is already qcow2 (idempotent after a partial conversion)", () => {
    const conf = {
      scsi0: `${STORAGE}:vm-250-disk-3.qcow2,size=32G`,
      scsi1: `${STORAGE}:vm-250-disk-2,size=100G`,
    }
    const vols = [{ volumeId: `${STORAGE}:vm-250-disk-3.qcow2` }, { volumeId: `${STORAGE}:vm-250-disk-2` }]
    expect(migratedDataDisks(conf, vols).map(d => d.slot)).toEqual(["scsi1"])
  })

  it("orders slots naturally so scsi10 converts after scsi2", () => {
    const conf = {
      scsi10: `${STORAGE}:vm-250-disk-1,size=1G`,
      scsi2: `${STORAGE}:vm-250-disk-2,size=1G`,
    }
    expect(migratedDataDisks(conf, ours).map(d => d.slot)).toEqual(["scsi2", "scsi10"])
  })

  it("handles an empty or missing config", () => {
    expect(migratedDataDisks(null, ours)).toEqual([])
    expect(migratedDataDisks({}, [])).toEqual([])
  })
})
