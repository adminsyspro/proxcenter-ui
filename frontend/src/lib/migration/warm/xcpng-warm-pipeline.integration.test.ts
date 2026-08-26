import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Integration harness for runXcpngWarmMigration.
 *
 * Drives the real XCP-ng warm pipeline end to end, together with the modules it
 * composes (apply, target-provision, power-off, finish, job-control, convergence),
 * with every external dependency replaced: XAPI calls are scripted, the NBD
 * reader lifecycle is recorded, SSH commands are answered by a router keyed on
 * the command shape, the PVE API and the job row are fakes.
 *
 * Everything runs under fake timers: the manual hold sleeps a minute between
 * passes, the power-off wait polls every 5 s and restates itself every minute,
 * so real timers would cost minutes. The block apply also moves the fake clock
 * forward (applyWallMs) so a delta pass has a wall time and the convergence
 * projection can exceed the budget, which is what a second delta pass needs.
 */

vi.mock("@/lib/ssh/exec", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() } // keep the real shellEscape
})
vi.mock("@/lib/proxmox/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/proxmox/client")>()
  return { ...actual, pveFetch: vi.fn() }
})
vi.mock("@/lib/connections/getConnection", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/connections/getConnection")>()
  return { ...actual, getConnectionById: vi.fn() }
})
vi.mock("@/lib/tenant", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>()
  return { ...actual, getTenantPrisma: vi.fn() }
})
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "root:secret"), encryptSecret: vi.fn() }))
vi.mock("../pve-tasks", () => ({ getNodeIpForMigration: vi.fn(), waitForPveTask: vi.fn() }))
vi.mock("../pvesm-alloc", async importOriginal => {
  const actual = await importOriginal<typeof import("../pvesm-alloc")>()
  // nextFreeDiskName, volumesToFree, volumesToKeep and PVESM_FREE_TIMEOUT_MS stay real.
  return { ...actual, allocateAndMapBlockVolume: vi.fn() }
})
vi.mock("../pve-vm-config", () => ({ pveSetVmConfig: vi.fn(), destroyPveVm: vi.fn() }))
vi.mock("../qcow2-convert", () => ({ convertDisksToQcow2: vi.fn() }))
vi.mock("../job-heartbeat", () => ({ startJobHeartbeat: vi.fn() }))
vi.mock("./xcpng-node-preflight", () => ({ checkNbdNodePreflight: vi.fn() }))
vi.mock("./xapi-reader", () => ({ startXapiReader: vi.fn(), stopXapiReader: vi.fn(), readAllocatedExtents: vi.fn() }))
vi.mock("./checksum-detector", () => ({ detectChangedExtentsByChecksum: vi.fn(), scanBlockChecksums: vi.fn() }))
vi.mock("./session-keepalive", () => ({ startSessionKeepAlive: vi.fn() }))
vi.mock("@/lib/xcpng/xapi-client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/xcpng/xapi-client")>()
  // CBT_CAPABLE_SR_TYPES and XapiError stay real.
  return {
    ...actual,
    xapiLogin: vi.fn(), xapiLogout: vi.fn(), xapiKeepAlive: vi.fn(), xapiGetVmConfig: vi.fn(), xapiVmRefByUuid: vi.fn(),
    xapiNbdEnabled: vi.fn(), xapiManagementNetworkUuid: vi.fn(), xapiEnableCbt: vi.fn(), xapiDisableCbt: vi.fn(),
    xapiSnapshotVm: vi.fn(), xapiGetNbdInfo: vi.fn(), xapiListChangedBlocks: vi.fn(), xapiDestroySnapshot: vi.fn(),
    xapiFindSnapshotsByPrefix: vi.fn(), xapiCleanShutdown: vi.fn(), xapiHardShutdown: vi.fn(), xapiPowerState: vi.fn(),
  }
})

import { executeSSH, type SSHExecOpts } from "@/lib/ssh/exec"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getTenantPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { getNodeIpForMigration, waitForPveTask } from "../pve-tasks"
import { allocateAndMapBlockVolume, type AllocatedVolume, type AllocateAndMapArgs } from "../pvesm-alloc"
import { pveSetVmConfig } from "../pve-vm-config"
import { convertDisksToQcow2 } from "../qcow2-convert"
import { startJobHeartbeat } from "../job-heartbeat"
import { checkNbdNodePreflight } from "./xcpng-node-preflight"
import { startXapiReader, stopXapiReader, readAllocatedExtents } from "./xapi-reader"
import { detectChangedExtentsByChecksum, scanBlockChecksums } from "./checksum-detector"
import { startSessionKeepAlive } from "./session-keepalive"
import {
  xapiLogin, xapiLogout, xapiKeepAlive, xapiGetVmConfig, xapiVmRefByUuid, xapiNbdEnabled, xapiManagementNetworkUuid,
  xapiEnableCbt, xapiDisableCbt, xapiSnapshotVm, xapiGetNbdInfo, xapiListChangedBlocks, xapiDestroySnapshot,
  xapiFindSnapshotsByPrefix, xapiCleanShutdown, xapiHardShutdown, xapiPowerState, XapiError, type XapiSnapshot,
} from "@/lib/xcpng/xapi-client"
import type { XoVmConfig } from "@/lib/xcpng/client"
import type { Extent } from "./extents"
import type { WarmMigrationConfig } from "./types"
import { requestWarmCutover, requestWarmForcePowerOff, cancelWarmMigrationJob, acquireVmLock, releaseVmLock } from "./job-control"
import { runXcpngWarmMigration, XCPNG_SNAPSHOT_PREFIX } from "./xcpng-warm-pipeline"

// ── Fixtures ──

const GiB = 1024 ** 3
const KiB = 1024
const DISK_BYTES = 15 * GiB
const PVE_CONN = { id: "conn-pve", baseUrl: "https://pve.test:8006", apiToken: "root@pam!t=x", insecureDev: true }
const NBD_INFO = {
  address: "10.0.0.9", port: 10809, exportname: "/x?session_id=OpaqueRef:s",
  cert: "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----", subject: "host",
}
/** Two changed blocks far enough apart that the applier keeps two dd lines. */
const SMALL_DELTA: Extent[] = [{ offset: 0, length: 64 * KiB }, { offset: 4 * 1024 * KiB, length: 64 * KiB }]

function makeVmConfig(srType = "ext"): XoVmConfig {
  return {
    uuid: "vm-uuid-1", name: "Debian13", powerState: "Running", numCPU: 1, memoryMB: 1024, firmware: "bios",
    virtualizationMode: "hvm", guestOS: "", tags: [], snapshotCount: 0, networks: [],
    disks: [{ vdiUuid: "vdi-uuid-0", vdiRef: "OpaqueRef:vdi0", srType, label: "disk", sizeBytes: DISK_BYTES, position: 0, srUuid: "sr-1" }],
  }
}

function makeConfig(overrides: Partial<WarmMigrationConfig> = {}): WarmMigrationConfig {
  return {
    sourceConnectionId: "conn-xcp",
    sourceVmId: "vm-uuid-1",
    targetConnectionId: "conn-pve",
    targetNode: "pve1",
    targetStorage: "DatastoreVM",
    networkBridge: "vmbr0",
    startAfterMigration: false,
    downtimeBudgetSec: 300,
    maxPasses: 3,
    ...overrides,
  }
}

// ── Scenario knobs (reset in beforeEach) ──

let vmConfig: XoVmConfig
let connRow: Record<string, any>
let storageType: string
/** Answers for xapiListChangedBlocks, one per call; an Error entry rejects. Empty queue = no change. */
let changedBlocks: Array<Extent[] | Error>
let guestHalted: boolean
let shutdownRefused: boolean
let applyFails: boolean
/** Fake wall time one block-apply script takes (moves the fake clock). */
let applyWallMs: number
/** Reader tag substring whose startXapiReader must fail (e.g. "vrfy"). */
let readerFailsFor: string | null
/** Ceph target: the allocation reports a mapped /dev/rbdN device that cleanup must unmap. */
let rbdMapped: boolean
/** UEFI shell: `qm create` already owns vm-<vmid>-disk-0 as efidisk0, data disks must number after it. */
let shellEfidisk: boolean
let snapCounter: number
let readerCounter: number
let destroyed: string[]
let sshCommands: string[]
let pveCalls: Array<{ path: string; method: string; body?: Record<string, string> }>
/** Hooks the fake job row fires so a scenario can react to the run without a real timer race. */
let hooks: { onLog?: (msg: string) => void; onUpdate?: (data: Record<string, any>) => void }

function ok(output = "") {
  return { success: true as const, output }
}

// ── SSH command router ──

async function sshRouter(_connId: string, _host: string, command: string, _timeoutMs?: number, opts?: SSHExecOpts) {
  sshCommands.push(command)
  if (command.includes("dd if=")) {
    // A block-apply script from buildApplyScripts (one dd per merged extent).
    if (applyFails) return { success: false as const, error: "dd: error writing '/dev/zvol/DatastoreVM/vm-900-disk-0': Input/output error" }
    // Two dd progress lines: the first flushes a live progress write, the second
    // lands inside the throttle window and is dropped.
    opts?.onData?.("1073741824 bytes (1.1 GB, 1.0 GiB) copied, 10 s, 107 MB/s\r")
    opts?.onData?.("2147483648 bytes (2.1 GB, 2.0 GiB) copied, 20 s, 107 MB/s\r")
    vi.setSystemTime(Date.now() + applyWallMs)
    return ok("")
  }
  if (command.startsWith("sz=$(blockdev --getsize64")) {
    // Thick zero script (plain LVM): the array refuses the offload, zeros stream.
    opts?.onData?.("blkdiscard-refused: Operation not supported\n")
    opts?.onData?.("1073741824 bytes (1.1 GB, 1.0 GiB) copied, 5 s, 214 MB/s\r")
    opts?.onData?.("2147483648 bytes (2.1 GB, 2.0 GiB) copied, 10 s, 214 MB/s\r")
    return ok("")
  }
  // blkdiscard, pvesm free, rbd unmap: plain success
  return ok("")
}

// ── PVE API router ──

async function pveRouter(_conn: unknown, path: string, init?: { method?: string; body?: URLSearchParams }) {
  pveCalls.push({ path, method: init?.method ?? "GET", body: init?.body ? Object.fromEntries(init.body) : undefined })
  if (path.startsWith("/storage/")) return { type: storageType }
  if (path === "/cluster/nextid") return "900"
  if (/^\/nodes\/[^/]+\/qemu$/.test(path) && init?.method === "POST") return "UPID:pve1:0000ABCD:qmcreate:900:root@pam:"
  if (/\/qemu\/(\d+)\/config$/.test(path) && shellEfidisk) {
    const vmid = /\/qemu\/(\d+)\/config$/.exec(path)![1]
    return { efidisk0: `DatastoreVM:vm-${vmid}-disk-0,efitype=4m,pre-enrolled-keys=1,size=528K` }
  }
  return {}
}

// ── Job row fake ──

function makeFakePrisma() {
  const row: Record<string, any> = { status: "pending", currentStep: null, logs: [] as any[], progress: 0 }
  /** Distinct statuses in write order (consecutive repeats collapsed). */
  const statusHistory: string[] = []
  /** Every (status, currentStep, progress) triple written through updateJob. */
  const updates: Array<{ status?: string; currentStep?: string; progress?: number }> = []
  const update = vi.fn(async ({ data }: any) => {
    if (data.status !== undefined) {
      if (statusHistory[statusHistory.length - 1] !== data.status) statusHistory.push(data.status)
      updates.push({ status: data.status, currentStep: data.currentStep, progress: data.progress })
    }
    Object.assign(row, data)
    if (Array.isArray(data.logs) && data.logs.length) hooks.onLog?.(data.logs[data.logs.length - 1].msg)
    hooks.onUpdate?.(data)
    return row
  })
  // Same guard as production: a throttled live flush never touches a terminal row.
  const updateMany = vi.fn(async ({ where, data }: any) => {
    if (where?.status?.notIn?.includes(row.status)) return { count: 0 }
    Object.assign(row, data)
    return { count: 1 }
  })
  return {
    row, statusHistory, updates,
    migrationJob: { findUnique: vi.fn(async () => ({ ...row })), update, updateMany },
    connection: { findUnique: vi.fn(async () => connRow) },
  }
}

let prisma: ReturnType<typeof makeFakePrisma>

const messages = () => (prisma.row.logs as Array<{ msg: string }>).map(l => l.msg)
const hasLog = (needle: string) => messages().some(m => m.includes(needle))
/** Reader tags in start order, from the socket names the pipeline chose. */
const readerTags = (jobId: string) =>
  vi.mocked(startXapiReader).mock.calls.map(c => c[2].sock.replace(`/tmp/proxcenter-xapi-${jobId}-`, "").replace(/\.sock$/, ""))
const createdSnapshots = () => vi.mocked(xapiSnapshotVm).mock.results.length

/**
 * Run the pipeline to completion under fake timers. Resolves with the error the
 * run threw (null on success) so failure scenarios can inspect it.
 */
async function runToEnd(jobId: string, config: WarmMigrationConfig): Promise<Error | null> {
  let settled = false
  let outcome: Error | null = null
  const run = runXcpngWarmMigration(jobId, config, "tenant-test").then(
    () => { settled = true },
    (e: Error) => { settled = true; outcome = e },
  )
  for (let i = 0; i < 3000 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(1000)
  }
  if (!settled) throw new Error("pipeline did not settle within the fake-time budget")
  await run
  return outcome
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  vmConfig = makeVmConfig()
  connRow = { id: "conn-xcp", type: "xcpng", subType: "xapi", baseUrl: "https://xcp.test", apiTokenEnc: "enc", insecureTLS: true }
  storageType = "zfspool"
  changedBlocks = []
  guestHalted = false
  shutdownRefused = false
  applyFails = false
  applyWallMs = 400_000
  readerFailsFor = null
  rbdMapped = false
  shellEfidisk = false
  snapCounter = 0
  readerCounter = 0
  destroyed = []
  sshCommands = []
  pveCalls = []
  hooks = {}
  prisma = makeFakePrisma()

  vi.mocked(getTenantPrisma).mockImplementation(() => prisma as any)
  vi.mocked(decryptSecret).mockReturnValue("root:secret")
  vi.mocked(getConnectionById).mockResolvedValue(PVE_CONN as any)
  vi.mocked(getNodeIpForMigration).mockResolvedValue("10.0.0.5")
  vi.mocked(waitForPveTask).mockResolvedValue(undefined)
  vi.mocked(startJobHeartbeat).mockReturnValue(() => {})
  vi.mocked(startSessionKeepAlive).mockReturnValue(() => {})
  vi.mocked(pveSetVmConfig).mockResolvedValue(undefined)
  vi.mocked(convertDisksToQcow2).mockImplementation(async args => {
    if (!args.enabled) return
    await args.setPhase(95)
    await args.log("qcow2 conversion complete: 1 disk(s) now support Proxmox snapshots.", "success")
  })
  vi.mocked(checkNbdNodePreflight).mockResolvedValue({ ok: true, missing: [] })
  vi.mocked(executeSSH).mockImplementation(sshRouter as any)
  vi.mocked(pveFetch).mockImplementation(pveRouter as any)

  // The real allocation registers a slot in the pipeline's cleanup array before
  // `pvesm alloc` runs; volumesToFree/volumesToKeep (kept real) read that array.
  vi.mocked(allocateAndMapBlockVolume).mockImplementation(async (args: AllocateAndMapArgs) => {
    const slot: AllocatedVolume = {
      volumeId: `${args.targetStorage}:${args.volName}`,
      devicePath: rbdMapped ? "/dev/rbd0" : `/dev/zvol/${args.targetStorage}/${args.volName}`,
      rbdMapped,
    }
    args.allocatedVolumes?.push(slot)
    return slot
  })

  vi.mocked(startXapiReader).mockImplementation(async (_c, _ip, t) => {
    if (readerFailsFor && t.sock.includes(readerFailsFor)) throw new Error("nbd-client failed to attach a free NBD device")
    const n = ++readerCounter
    return { nbdDev: `/dev/nbd${n}`, sock: t.sock, logFile: `${t.sock}.log`, caDir: `${t.sock}.ca` }
  })
  vi.mocked(stopXapiReader).mockResolvedValue(undefined)
  vi.mocked(readAllocatedExtents).mockResolvedValue([{ offset: 0, length: DISK_BYTES }])
  vi.mocked(detectChangedExtentsByChecksum).mockImplementation(async (_c, _ip, _src, _dst, _bs, _len, opts) => {
    opts?.onProgress?.(1, 120)  // first report flushes a live scan-progress write
    opts?.onProgress?.(2, 120)  // second one lands inside the throttle window
    return [{ offset: 0, length: 256 * 1024 * KiB }]
  })
  vi.mocked(scanBlockChecksums).mockResolvedValue(["abc"])

  vi.mocked(xapiLogin).mockImplementation(async (baseUrl, _u, _p, insecureTLS) => ({ baseUrl, insecureTLS, ref: "OpaqueRef:s" }))
  vi.mocked(xapiLogout).mockResolvedValue(undefined)
  vi.mocked(xapiKeepAlive).mockResolvedValue(undefined)
  vi.mocked(xapiVmRefByUuid).mockResolvedValue("OpaqueRef:vm")
  vi.mocked(xapiGetVmConfig).mockImplementation(async () => vmConfig)
  vi.mocked(xapiNbdEnabled).mockResolvedValue(true)
  vi.mocked(xapiManagementNetworkUuid).mockResolvedValue("net-uuid-1")
  vi.mocked(xapiEnableCbt).mockResolvedValue(undefined)
  vi.mocked(xapiDisableCbt).mockResolvedValue(undefined)
  vi.mocked(xapiGetNbdInfo).mockResolvedValue(NBD_INFO)
  vi.mocked(xapiFindSnapshotsByPrefix).mockResolvedValue([])
  vi.mocked(xapiSnapshotVm).mockImplementation(async (_s, _vmRef, nameLabel) => {
    const n = ++snapCounter
    const snap: XapiSnapshot = {
      ref: `OpaqueRef:snap${n}`, uuid: `snap-uuid-${n}`, nameLabel,
      disks: vmConfig.disks.map(d => ({
        position: d.position, vdiRef: `OpaqueRef:snapvdi${n}-${d.position}`, vdiUuid: `snapvdi-uuid-${n}-${d.position}`,
        snapshotOfRef: d.vdiRef!, sizeBytes: d.sizeBytes,
      })),
    }
    return snap
  })
  vi.mocked(xapiDestroySnapshot).mockImplementation(async (_s, ref) => { destroyed.push(ref) })
  vi.mocked(xapiListChangedBlocks).mockImplementation(async () => {
    const next = changedBlocks.shift() ?? []
    if (next instanceof Error) throw next
    return next
  })
  vi.mocked(xapiPowerState).mockImplementation(async () => (guestHalted ? "Halted" : "Running"))
  vi.mocked(xapiCleanShutdown).mockImplementation(async () => {
    if (shutdownRefused) throw new Error("VM_FAILED_SHUTDOWN_ACKNOWLEDGMENT")
    guestHalted = true
  })
  vi.mocked(xapiHardShutdown).mockImplementation(async () => { guestHalted = true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("runXcpngWarmMigration CBT path", () => {
  it("converges in two delta passes and cuts over on its own", { timeout: 20000 }, async () => {
    const jobId = "xcp-it-auto"
    // Delta 1 carries data and takes 400 s of fake wall time (projection 450 s,
    // over the 300 s budget); delta 2 is empty, so the projection drops to the
    // 50 s floor and decideNextPass cuts over. The cutover pass reads [] too.
    changedBlocks = [SMALL_DELTA, []]

    const err = await runToEnd(jobId, makeConfig({ startAfterMigration: true, convertDisksToQcow2: true }))

    expect(err).toBeNull()
    expect(prisma.statusHistory).toEqual(["planning", "enabling_cbt", "preparing_disks", "full_copy", "delta_sync", "cutover", "verify", "converting_disks", "completed"])
    expect(prisma.row.status).toBe("completed")
    expect(prisma.row.progress).toBe(100)
    expect(prisma.row.completedAt).toBeInstanceOf(Date)
    expect(prisma.row.sourceVmName).toBe("Debian13")
    expect(prisma.row.targetVmid).toBe(900)

    // planning gathered everything before touching the pool
    expect(xapiLogin).toHaveBeenCalledWith("https://xcp.test", "root", "secret", true)
    expect(xapiEnableCbt).toHaveBeenCalledTimes(1)
    expect(xapiEnableCbt).toHaveBeenCalledWith(expect.objectContaining({ ref: "OpaqueRef:s" }), "OpaqueRef:vdi0")
    const create = pveCalls.find(c => c.path === "/nodes/pve1/qemu" && c.method === "POST")
    expect(create?.body).toEqual(expect.objectContaining({ vmid: "900", name: "Debian13", bios: "seabios", net0: "virtio,bridge=vmbr0", serial0: "socket" }))
    expect(waitForPveTask).toHaveBeenCalledWith(expect.objectContaining({ id: "conn-pve" }), "pve1", "UPID:pve1:0000ABCD:qmcreate:900:root@pam:")
    // thin storage: a cheap discard, never the thick zero script
    expect(sshCommands.some(c => c.startsWith("blkdiscard '/dev/zvol/DatastoreVM/vm-900-disk-0'"))).toBe(true)
    expect(sshCommands.some(c => c.includes("blockdev --getsize64"))).toBe(false)
    expect(hasLog("Disk 0: target DatastoreVM:vm-900-disk-0")).toBe(true)

    // four snapshots (full, delta-1, delta-2, cutover): each pass drops the previous one, the cutover drops its own
    expect(createdSnapshots()).toBe(4)
    expect(vi.mocked(xapiSnapshotVm).mock.calls.map(c => c[2])).toEqual([
      `${XCPNG_SNAPSHOT_PREFIX}-full`, `${XCPNG_SNAPSHOT_PREFIX}-delta-1`, `${XCPNG_SNAPSHOT_PREFIX}-delta-2`, `${XCPNG_SNAPSHOT_PREFIX}-cutover`,
    ])
    expect(destroyed).toEqual(["OpaqueRef:snap1", "OpaqueRef:snap2", "OpaqueRef:snap3", "OpaqueRef:snap4"])
    expect(xapiFindSnapshotsByPrefix).not.toHaveBeenCalled()
    // the delta was asked between consecutive snapshots of the same VDI
    expect(xapiListChangedBlocks).toHaveBeenNthCalledWith(1, expect.anything(), "OpaqueRef:snapvdi1-0", "OpaqueRef:snapvdi2-0", DISK_BYTES)
    expect(xapiListChangedBlocks).toHaveBeenCalledTimes(3)

    // reader lifetime rule: the full pass needs one for the allocated map, the
    // non-empty delta opens one at apply time, the empty delta and the empty
    // cutover pass never start one, verify opens its own
    expect(readerTags(jobId)).toEqual(["full-0", "delta-1-0", "vrfy-0"])
    expect(stopXapiReader).toHaveBeenCalledTimes(3)
    expect(readAllocatedExtents).toHaveBeenCalledTimes(1)
    // the apply streamed dd progress into the job (live write + throttled log line)
    expect(messages().some(m => /^Disk 0: copying [\d.]+ GB at \d+ MB\/s$/.test(m))).toBe(true)
    expect(prisma.migrationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "full_copy", bytesTransferred: expect.any(BigInt) }),
    }))
    expect(hasLog("Full copy done: 15.00 GB")).toBe(true)
    expect(hasLog("Delta pass 1: 0.1 MB")).toBe(true)
    expect(hasLog("Delta pass 2: 0.0 MB")).toBe(true)
    expect(prisma.row.projectedDowntimeSec).toBe(50)

    // cutover: confirmed power off, final delta, CBT switched back off
    expect(xapiCleanShutdown).toHaveBeenCalledTimes(1)
    expect(xapiHardShutdown).not.toHaveBeenCalled()
    expect(prisma.updates.some(u => u.status === "cutover" && u.currentStep === "awaiting_power_off")).toBe(true)
    expect(hasLog("Source powered off (confirmed): applying final delta")).toBe(true)
    expect(xapiDisableCbt).toHaveBeenCalledWith(expect.anything(), "OpaqueRef:vdi0")

    // verify then attach + boot
    expect(hasLog("Verify: disk 0 sampled block matches")).toBe(true)
    expect(pveSetVmConfig).toHaveBeenCalledTimes(1)
    const attach = vi.mocked(pveSetVmConfig).mock.calls[0]
    expect(attach[1]).toBe("pve1")
    expect(attach[2]).toBe(900)
    expect(attach[3].get("scsi0")).toBe("DatastoreVM:vm-900-disk-0")
    expect(attach[3].get("boot")).toBe("order=scsi0")
    expect(pveCalls.some(c => c.path === "/nodes/pve1/qemu/900/status/start" && c.method === "POST")).toBe(true)
    expect(hasLog("Target VM started")).toBe(true)
    expect(convertDisksToQcow2).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, vmid: 900, targetStorage: "DatastoreVM" }))
    expect(hasLog("qcow2 conversion complete")).toBe(true)
    expect(hasLog("Warm migration complete")).toBe(true)

    // nothing freed, nothing kept-with-a-warning, session closed in finally
    expect(sshCommands.some(c => c.startsWith("pvesm free"))).toBe(false)
    expect(hasLog("Kept target volume")).toBe(false)
    expect(xapiLogout).toHaveBeenCalledTimes(1)
  })

  it("holds in manual mode until the operator requests the cutover", { timeout: 20000 }, async () => {
    const jobId = "xcp-it-manual"
    changedBlocks = [SMALL_DELTA, [], []]
    readerFailsFor = "vrfy" // the sampled verify must degrade to a warning, never fail the run
    // Operator double: 90 s after the first delta pass reports, i.e. during the
    // hold that follows the SECOND pass (the hold between passes is a minute).
    let armed = false
    hooks.onLog = msg => {
      if (!armed && msg.startsWith("Delta pass 1:")) { armed = true; setTimeout(() => requestWarmCutover(jobId), 90_000) }
    }

    const err = await runToEnd(jobId, makeConfig({ cutoverMode: "manual" }))

    expect(err).toBeNull()
    expect(prisma.row.status).toBe("completed")
    expect(hasLog("Manual cutover: replication will keep running")).toBe(true)
    // two hold passes ran (delta_1, delta_2) before the operator's request broke the loop
    expect(hasLog("Delta pass 1:")).toBe(true)
    expect(hasLog("Delta pass 2:")).toBe(true)
    expect(hasLog("Delta pass 3:")).toBe(false)
    expect(hasLog("Operator requested cutover: proceeding to final delta")).toBe(true)
    // manual mode never parks at the operator gate and never decides on a number
    expect(prisma.statusHistory).not.toContain("awaiting_cutover")
    // a manual hold pins the bar at 88-90 while it waits
    expect(prisma.updates.some(u => u.status === "delta_sync" && u.progress === 90)).toBe(true)
    // the verify reader refused to start: warning, not failure
    expect(hasLog("Verify (sampled) skipped on disk 0: nbd-client failed to attach")).toBe(true)
    expect(createdSnapshots()).toBe(4) // full, delta-1, delta-2, cutover
    expect(destroyed).toHaveLength(4)
    expect(xapiLogout).toHaveBeenCalledTimes(1)
  })

  it("parks at the operator gate when the pass cap is reached over budget, then resumes on the request", { timeout: 20000 }, async () => {
    const jobId = "xcp-it-gate"
    changedBlocks = [SMALL_DELTA, []]
    hooks.onUpdate = data => {
      if (data.status === "awaiting_cutover") setTimeout(() => requestWarmCutover(jobId), 7000)
    }
    // the pool refuses to drop the full snapshot after delta-1: a warning names it, the run goes on
    vi.mocked(xapiDestroySnapshot).mockRejectedValueOnce(new Error("VDI_IN_USE"))

    // one pass allowed, and that pass projects 450 s against a 300 s budget
    const err = await runToEnd(jobId, makeConfig({ maxPasses: 1 }))

    expect(err).toBeNull()
    expect(prisma.row.status).toBe("completed")
    expect(prisma.statusHistory).toEqual(["planning", "enabling_cbt", "preparing_disks", "full_copy", "delta_sync", "awaiting_cutover", "cutover", "verify", "completed"])
    expect(hasLog("Reached 1 delta passes; projected cutover downtime ~450s")).toBe(true)
    expect(hasLog("The source is changing faster than it converges.")).toBe(true)
    expect(hasLog("Operator requested cutover")).toBe(true)
    expect(createdSnapshots()).toBe(3) // full, delta-1, cutover
    expect(hasLog(`Warning: snapshot ${XCPNG_SNAPSHOT_PREFIX}-full (snap-uuid-1) was not removed (VDI_IN_USE); delete it on the XCP-ng pool`)).toBe(true)
    expect(destroyed).toEqual(["OpaqueRef:snap2", "OpaqueRef:snap3"])
    expect(prisma.row.status).toBe("completed")
  })

  it("falls back to the allocated map of a disk whose CBT chain is broken", { timeout: 20000 }, async () => {
    const jobId = "xcp-it-cbtfail"
    // The operator asks for the cutover while the full copy is still running, so
    // the delta loop breaks at its first check and the cutover pass is the only
    // delta: its VDI.list_changed_blocks fails the way XAPI does after a coalesce.
    changedBlocks = [new XapiError("VDI_NO_CBT_METADATA", ["OpaqueRef:snapvdi2-0"])]
    hooks.onLog = msg => { if (msg.startsWith("Full copy done")) requestWarmCutover(jobId) }

    const err = await runToEnd(jobId, makeConfig())

    expect(err).toBeNull()
    expect(prisma.row.status).toBe("completed")
    // no delta pass at all: the loop broke on the pending request before its first pass
    expect(prisma.statusHistory).toEqual(["planning", "enabling_cbt", "preparing_disks", "full_copy", "cutover", "verify", "completed"])
    expect(hasLog("Operator requested cutover: proceeding to final delta")).toBe(true)
    expect(hasLog('Disk 0 ("disk"): changed block list unavailable (VDI_NO_CBT_METADATA OpaqueRef:snapvdi2-0); copying every allocated block')).toBe(true)
    // allocated map read twice: the full pass, then the cutover pass as fallback
    expect(readAllocatedExtents).toHaveBeenCalledTimes(2)
    expect(readerTags(jobId)).toEqual(["full-0", "cutover-0", "vrfy-0"])
    expect(destroyed).toEqual(["OpaqueRef:snap1", "OpaqueRef:snap2"])
  })

  it("waits for a confirmed power off and honours the operator's forced power off", { timeout: 30000 }, async () => {
    const jobId = "xcp-it-forceoff"
    changedBlocks = [[]] // empty first delta: straight to cutover
    shutdownRefused = true
    // the host refuses the hard power off too; the guest is stopped from inside 15 s later
    vi.mocked(xapiHardShutdown).mockImplementation(async () => {
      setTimeout(() => { guestHalted = true }, 15_000)
      throw new Error("OPERATION_NOT_ALLOWED")
    })
    let armed = false
    hooks.onUpdate = data => {
      // 70 s into the wait: past the first 60 s "still waiting" heartbeat
      if (!armed && data.currentStep === "awaiting_power_off") { armed = true; setTimeout(() => requestWarmForcePowerOff(jobId), 70_000) }
    }

    // no budget and no pass cap in the config: the pipeline's defaults (300 s, 5 passes) apply
    const err = await runToEnd(jobId, makeConfig({ downtimeBudgetSec: undefined, maxPasses: undefined }))

    expect(err).toBeNull()
    expect(prisma.row.status).toBe("completed")
    expect(hasLog("Guest shutdown could not be initiated (VM_FAILED_SHUTDOWN_ACKNOWLEDGMENT)")).toBe(true)
    expect(hasLog("The guest refused the shutdown request. Waiting up to 30 min")).toBe(true)
    expect(hasLog("Still waiting for the source to power off; 29 min left")).toBe(true)
    expect(hasLog("Operator requested a hard power off of the source")).toBe(true)
    expect(xapiHardShutdown).toHaveBeenCalledTimes(1)
    expect(hasLog("Hard power off was refused by the source host (OPERATION_NOT_ALLOWED); still waiting for a powered-off state")).toBe(true)
    // polled while Running, then saw Halted after the hard power off
    expect(vi.mocked(xapiPowerState).mock.calls.length).toBeGreaterThan(10)
    expect(hasLog("Source powered off (confirmed): applying final delta")).toBe(true)
  })
})

describe("runXcpngWarmMigration checksum fallback", () => {
  it("shuts the source down before the copy when the SR cannot track changes", { timeout: 20000 }, async () => {
    const jobId = "xcp-it-checksum"
    vmConfig = { ...makeVmConfig("zfs-vol"), firmware: "uefi" }
    shellEfidisk = true // OVMF shell: `qm create` made vm-777-disk-0 for the EFI vars
    // source and target first blocks differ: the sampled verify must warn, not fail
    vi.mocked(scanBlockChecksums).mockResolvedValueOnce(["abc"]).mockResolvedValueOnce(["def"])

    const err = await runToEnd(jobId, makeConfig({ targetVmid: 777 }))

    expect(err).toBeNull()
    expect(prisma.statusHistory).toEqual(["planning", "enabling_cbt", "preparing_disks", "full_copy", "verify", "completed"])
    // pinned VMID: no nextid lookup; UEFI shell gets its efidisk, the data disk numbers after it
    expect(pveCalls.some(c => c.path === "/cluster/nextid")).toBe(false)
    const create = pveCalls.find(c => c.path === "/nodes/pve1/qemu" && c.method === "POST")
    expect(create?.body).toEqual(expect.objectContaining({ vmid: "777", bios: "ovmf", efidisk0: "DatastoreVM:1,efitype=4m,pre-enrolled-keys=1" }))
    expect(allocateAndMapBlockVolume).toHaveBeenCalledWith(expect.objectContaining({ targetVmid: 777, volName: "vm-777-disk-1", sizeKB: DISK_BYTES / 1024 }))
    expect(hasLog('CBT unavailable (SR type "zfs-vol" of disk "disk" does not support changed block tracking); using checksum block-diff fallback')).toBe(true)
    expect(xapiEnableCbt).not.toHaveBeenCalled()
    expect(xapiDisableCbt).not.toHaveBeenCalled()
    expect(xapiListChangedBlocks).not.toHaveBeenCalled()
    // the guest is stopped BEFORE anything is copied, and the log says so
    expect(prisma.updates.some(u => u.status === "full_copy" && u.currentStep === "source_shutdown")).toBe(true)
    expect(prisma.updates.some(u => u.status === "full_copy" && u.currentStep === "awaiting_power_off")).toBe(true)
    expect(hasLog("Checksum fallback: requesting clean guest shutdown of the source BEFORE the copy")).toBe(true)
    const shutdownIdx = vi.mocked(xapiCleanShutdown).mock.invocationCallOrder[0]
    const detectIdx = vi.mocked(detectChangedExtentsByChecksum).mock.invocationCallOrder[0]
    expect(shutdownIdx).toBeLessThan(detectIdx)
    // one checksum snapshot, one reader, one block-diff pass, snapshot dropped in finally
    expect(vi.mocked(xapiSnapshotVm).mock.calls.map(c => c[2])).toEqual([`${XCPNG_SNAPSHOT_PREFIX}-checksum`])
    expect(readerTags(jobId)).toEqual(["checksum-0", "vrfy-0"])
    expect(detectChangedExtentsByChecksum).toHaveBeenCalledWith("conn-pve", "10.0.0.5", "/dev/nbd1", "/dev/zvol/DatastoreVM/vm-777-disk-1", 256 * 1024 * KiB, DISK_BYTES, expect.anything())
    expect(hasLog("Disk 0: scanning source and target block checksums (15.0 GB)")).toBe(true)
    // the scan progress callback drove a live write on the full_copy scale
    expect(prisma.migrationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "full_copy", transferSpeed: null }),
    }))
    expect(sshCommands.filter(c => c.includes("dd if=")).length).toBe(1)
    expect(destroyed).toEqual(["OpaqueRef:snap1"])
    expect(hasLog("Verify: disk 0 first-block checksum differs")).toBe(true)
    expect(prisma.row.status).toBe("completed")
    // UEFI boot disk goes to sata0 (no boot-start VirtIO driver in an untouched guest)
    const attach = vi.mocked(pveSetVmConfig).mock.calls[0]
    expect(attach[2]).toBe(777)
    expect(attach[3].get("sata0")).toBe("DatastoreVM:vm-777-disk-1")
    expect(attach[3].get("boot")).toBe("order=sata0")
    expect(convertDisksToQcow2).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
    expect(prisma.statusHistory).not.toContain("converting_disks")
  })
})

describe("runXcpngWarmMigration failure cleanup", () => {
  it("frees the half-written target and drops its snapshot when the full pass fails, then lets the VM run again", { timeout: 20000 }, async () => {
    const jobId = "xcp-it-applyfail"
    storageType = "lvm" // thick target: the mandatory zero step runs before the copy
    applyFails = true

    const err = await runToEnd(jobId, makeConfig())

    expect(err).toBeInstanceOf(Error)
    expect(err?.message.startsWith("block apply failed on disk 0: dd: error writing")).toBe(true)
    expect(prisma.row.status).toBe("failed")
    expect(prisma.row.error.startsWith("block apply failed")).toBe(true)
    expect(prisma.statusHistory).toEqual(["planning", "enabling_cbt", "preparing_disks", "full_copy", "failed"])
    expect(hasLog("Warm migration failed: block apply failed on disk 0")).toBe(true)

    // thick path: announced, refusal of the offload surfaced, progress streamed, completion logged
    expect(hasLog("Disk 0: zeroing thick target /dev/zvol/DatastoreVM/vm-900-disk-0 (15.0 GB)")).toBe(true)
    expect(hasLog("Disk 0: array refused the blkdiscard write-zeroes offload (Operation not supported)")).toBe(true)
    expect(messages().some(m => /^Disk 0: zeroed [\d.]+ of 15\.0 GB$/.test(m))).toBe(true)
    expect(hasLog("Disk 0: zeroed thick target /dev/zvol/DatastoreVM/vm-900-disk-0")).toBe(true)
    expect(prisma.migrationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "preparing_disks", transferSpeed: expect.stringMatching(/^Zeroing: \d+ MB\/s$/) }),
    }))

    // cleanup: the tracked snapshot is gone, the reader torn down, the volume freed (never marked copied)
    expect(destroyed).toEqual(["OpaqueRef:snap1"])
    expect(xapiFindSnapshotsByPrefix).toHaveBeenCalledWith(expect.anything(), "OpaqueRef:vm", `${XCPNG_SNAPSHOT_PREFIX}-`)
    expect(stopXapiReader).toHaveBeenCalledTimes(1)
    expect(sshCommands).toContain("pvesm free 'DatastoreVM:vm-900-disk-0' 2>/dev/null")
    expect(hasLog("Kept target volume")).toBe(false)
    expect(pveSetVmConfig).not.toHaveBeenCalled()
    expect(xapiDisableCbt).not.toHaveBeenCalled()
    expect(xapiLogout).toHaveBeenCalledTimes(1)

    // the per-VM lock was released: the same source VM can be migrated again
    applyFails = false
    storageType = "zfspool"
    changedBlocks = [[]]
    prisma = makeFakePrisma()
    const again = await runToEnd("xcp-it-applyfail-retry", makeConfig())
    expect(again).toBeNull()
    expect(prisma.row.status).toBe("completed")
    expect(hasLog("already running")).toBe(false)
  })

  it("stops at the next check when the job is cancelled during the delta loop", { timeout: 20000 }, async () => {
    const jobId = "xcp-it-cancel"
    changedBlocks = [SMALL_DELTA, SMALL_DELTA, SMALL_DELTA] // never converges on its own
    hooks.onLog = msg => { if (msg.startsWith("Delta pass 1:")) cancelWarmMigrationJob(jobId) }
    // the belt-and-braces prefix sweep failing must not hide the cancellation
    vi.mocked(xapiFindSnapshotsByPrefix).mockRejectedValue(new Error("SESSION_INVALID"))

    const err = await runToEnd(jobId, makeConfig())

    expect(err?.message).toBe("Migration cancelled")
    expect(prisma.row.status).toBe("cancelled")
    expect(prisma.row.error).toBe("Migration cancelled")
    expect(hasLog("Delta pass 1:")).toBe(true)
    expect(hasLog("Delta pass 2:")).toBe(false)
    expect(xapiCleanShutdown).not.toHaveBeenCalled()
    // the full snapshot went with the first delta pass; the delta-1 baseline is dropped by cleanup
    expect(createdSnapshots()).toBe(2)
    expect(destroyed).toEqual(["OpaqueRef:snap1", "OpaqueRef:snap2"])
    // the full pass completed, so the target holds a consistent copy: kept, not freed
    expect(sshCommands.some(c => c.startsWith("pvesm free"))).toBe(false)
    expect(hasLog("Kept target volume DatastoreVM:vm-900-disk-0: it holds a completed copy")).toBe(true)
    expect(pveSetVmConfig).not.toHaveBeenCalled()
    expect(xapiLogout).toHaveBeenCalledTimes(1)
  })

  it("names the snapshots it could not remove instead of failing silently", { timeout: 20000 }, async () => {
    const jobId = "xcp-it-leftover"
    applyFails = true
    storageType = "rbd"
    rbdMapped = true
    vi.mocked(xapiDestroySnapshot).mockImplementation(async (_s, ref) => {
      if (ref === "OpaqueRef:stuck") throw new Error("VDI_IN_USE")
      destroyed.push(ref)
    })
    vi.mocked(xapiDestroySnapshot).mockRejectedValueOnce(new Error("VDI_IN_USE"))
    vi.mocked(xapiFindSnapshotsByPrefix).mockResolvedValue(["OpaqueRef:snap1", "OpaqueRef:old", "OpaqueRef:stuck"])

    const err = await runToEnd(jobId, makeConfig())

    expect(err?.message.startsWith("block apply failed")).toBe(true)
    expect(hasLog("Warning: could not remove warm snapshot OpaqueRef:snap1: VDI_IN_USE; delete it on the XCP-ng pool")).toBe(true)
    // the one that failed is not retried through the prefix sweep; the older leftover is removed; the stuck one is named
    expect(destroyed).toEqual(["OpaqueRef:old"])
    expect(hasLog("Removed leftover warm snapshot OpaqueRef:old from the source VM")).toBe(true)
    expect(hasLog("Warning: could not remove warm snapshot OpaqueRef:stuck: VDI_IN_USE")).toBe(true)
    // Ceph: the mapped device is unmapped before the volume is freed
    const unmapIdx = sshCommands.indexOf('rbd unmap "/dev/rbd0" 2>/dev/null')
    const freeIdx = sshCommands.indexOf("pvesm free 'DatastoreVM:vm-900-disk-0' 2>/dev/null")
    expect(unmapIdx).toBeGreaterThan(-1)
    expect(freeIdx).toBeGreaterThan(unmapIdx)
  })

  it("keeps the completed copy when the attach fails at cutover", { timeout: 20000 }, async () => {
    const jobId = "xcp-it-attachfail"
    changedBlocks = [[]]
    vi.mocked(pveSetVmConfig).mockRejectedValue(new Error("storage 'DatastoreVM' is not online"))

    const err = await runToEnd(jobId, makeConfig())

    expect(err?.message).toBe("FATAL: could not attach target disks at cutover: storage 'DatastoreVM' is not online")
    expect(prisma.row.status).toBe("failed")
    expect(prisma.statusHistory).toEqual(["planning", "enabling_cbt", "preparing_disks", "full_copy", "delta_sync", "cutover", "verify", "failed"])
    // never boot a VM with unattached disks
    expect(pveCalls.some(c => c.path.endsWith("/status/start"))).toBe(false)
    // the source is already off and CBT already disabled: the copy is complete, so it is kept (#612)
    expect(xapiDisableCbt).toHaveBeenCalledTimes(1)
    expect(sshCommands.some(c => c.startsWith("pvesm free"))).toBe(false)
    expect(hasLog("Kept target volume DatastoreVM:vm-900-disk-0: it holds a completed copy of the source disk")).toBe(true)
    expect(destroyed).toHaveLength(3) // full, delta-1, cutover: nothing left on the pool
    expect(xapiLogout).toHaveBeenCalledTimes(1)
  })
})

describe("runXcpngWarmMigration refusals at planning", () => {
  const noVmCreated = () => expect(pveCalls.some(c => c.method === "POST")).toBe(false)

  it("refuses a connection that goes through Xen Orchestra", { timeout: 20000 }, async () => {
    connRow = { ...connRow, subType: "xo" }

    const err = await runToEnd("xcp-it-xo", makeConfig())

    expect(err?.message).toContain("this connection goes through Xen Orchestra, which only supports offline migration")
    expect(prisma.row.status).toBe("failed")
    expect(prisma.row.error).toContain("Xen Orchestra")
    expect(xapiLogin).not.toHaveBeenCalled()
    noVmCreated()
    expect(xapiLogout).not.toHaveBeenCalled()
  })

  it("refuses a second run for a source VM that is already migrating", { timeout: 20000 }, async () => {
    const config = makeConfig()
    const vmKey = `${config.sourceConnectionId}:${config.sourceVmId}`
    expect(acquireVmLock(vmKey)).toBe(true)
    try {
      const err = await runToEnd("xcp-it-locked", config)
      expect(err?.message).toContain("A warm migration is already running for this source VM")
      expect(prisma.row.status).toBe("failed")
      expect(prisma.connection.findUnique).not.toHaveBeenCalled()
    } finally {
      releaseVmLock(vmKey)
    }
    // the refused run must not have released a lock it never held
    expect(acquireVmLock(vmKey)).toBe(true)
    releaseVmLock(vmKey)
  })

  it("refuses a file-based target storage", { timeout: 20000 }, async () => {
    storageType = "nfs"

    const err = await runToEnd("xcp-it-filestorage", makeConfig())

    expect(err?.message).toContain('"DatastoreVM" is file-based (nfs)')
    expect(prisma.row.status).toBe("failed")
    noVmCreated()
    expect(xapiLogout).toHaveBeenCalledTimes(1)
  })

  it("refuses a node without the NBD tooling", { timeout: 20000 }, async () => {
    vi.mocked(checkNbdNodePreflight).mockResolvedValue({ ok: false, missing: ["nbdkit", "nbdinfo"] })

    const err = await runToEnd("xcp-it-preflight", makeConfig())

    expect(err?.message).toContain("missing the NBD tooling for warm migration (nbdkit, nbdinfo)")
    expect(err?.message).toContain("apt install nbdkit nbd-client libnbd-bin")
    noVmCreated()
  })

  it("tells the operator how to enable NBD on the pool when no network offers it", { timeout: 20000 }, async () => {
    vi.mocked(xapiNbdEnabled).mockResolvedValue(false)

    const err = await runToEnd("xcp-it-nonbd", makeConfig())

    expect(err?.message).toContain("xe network-param-add uuid=net-uuid-1 param-name=purpose param-key=nbd")
    noVmCreated()
  })

  it("stops a job cancelled during planning before any target VM exists", { timeout: 20000 }, async () => {
    const jobId = "xcp-it-cancel-planning"
    hooks.onLog = msg => { if (msg.startsWith("NBD tooling preflight OK")) cancelWarmMigrationJob(jobId) }

    const err = await runToEnd(jobId, makeConfig())

    expect(err?.message).toBe("Migration cancelled")
    expect(prisma.row.status).toBe("cancelled")
    expect(prisma.statusHistory).toEqual(["planning", "cancelled"])
    expect(xapiEnableCbt).not.toHaveBeenCalled()
    noVmCreated()
    expect(xapiLogout).toHaveBeenCalledTimes(1)
  })

  it("refuses a VM without disks", { timeout: 20000 }, async () => {
    vmConfig = { ...makeVmConfig(), disks: [] }

    const err = await runToEnd("xcp-it-nodisks", makeConfig())

    expect(err?.message).toBe("VM has no disks to migrate")
    noVmCreated()
  })
})
