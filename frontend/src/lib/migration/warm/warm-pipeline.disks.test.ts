import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Run harness for the per-disk choices of runWarmMigration (#317, lot 2).
 *
 * The real VMware warm pipeline runs end to end, together with the modules it
 * composes (target-provision, job-control, convergence, the mapper), with every
 * external dependency replaced: the vSphere SOAP and CBT calls are scripted,
 * the VDDK readers and the block apply are recorded, SSH is answered by a
 * router keyed on the command shape, the PVE API and the job row are fakes.
 * What the tests read back is which disks were sized, checked, allocated,
 * read, applied, verified and attached, and on which storage.
 */

vi.mock("@/lib/ssh/exec", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() } // keep the real shellEscape
})
vi.mock("@/lib/proxmox/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/proxmox/client")>()
  return { ...actual, pveFetch: vi.fn() }
})
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: vi.fn() }))
vi.mock("@/lib/tenant", () => ({ getTenantPrisma: vi.fn() }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "root:secret"), encryptSecret: vi.fn() }))
vi.mock("../pve-tasks", () => ({ getNodeSshEndpointForMigration: vi.fn(), waitForPveTask: vi.fn() }))
vi.mock("../reserve-target-vmid", () => ({ reserveTargetVmid: vi.fn() }))
vi.mock("../pvesm-alloc", async importOriginal => {
  const actual = await importOriginal<typeof import("../pvesm-alloc")>()
  // nextFreeDiskName, volumesToFree, volumesToKeep stay real.
  return { ...actual, allocateAndMapBlockVolume: vi.fn() }
})
vi.mock("../job-heartbeat", () => ({ startJobHeartbeat: vi.fn(() => () => {}) }))
vi.mock("../integrity-target", () => ({ resolveIntegritySettings: vi.fn(async () => ({ enabled: false, regionCount: 0, regionSizeMiB: 4 })) }))
vi.mock("./session-keepalive", () => ({ startSoapKeepAlive: vi.fn(() => () => {}) }))
vi.mock("./vddk-preflight", () => ({ checkVddkPreflight: vi.fn() }))
vi.mock("./orphan-readers", () => ({ sweepOrphanReaders: vi.fn(async () => {}) }))
vi.mock("./copy-path", () => ({ resolveCopyPath: vi.fn() }))
vi.mock("./nfc-reachability", async importOriginal => {
  const actual = await importOriginal<typeof import("./nfc-reachability")>()
  return { ...actual, checkNfcReachability: vi.fn() }
})
vi.mock("./vddk-reader", async importOriginal => {
  const actual = await importOriginal<typeof import("./vddk-reader")>()
  return { ...actual, startVddkReader: vi.fn(), stopVddkReader: vi.fn(async () => {}) }
})
vi.mock("./apply", async importOriginal => {
  const actual = await importOriginal<typeof import("./apply")>()
  return { ...actual, applyExtentsWithProgress: vi.fn(async () => {}) }
})
vi.mock("./checksum-detector", () => ({ detectChangedExtentsByChecksum: vi.fn() }))
vi.mock("./power-off", async importOriginal => {
  const actual = await importOriginal<typeof import("./power-off")>()
  return { ...actual, cleanShutdownAndConfirm: vi.fn(async () => {}) }
})
vi.mock("./finish", () => ({
  attachDisksAndBoot: vi.fn(async () => {}), removeTargetVmOnFailure: vi.fn(async () => {}),
  unmapTargetVolumes: vi.fn(async () => {}), verifyWarmDiskIntegrity: vi.fn(async () => {}),
}))
vi.mock("./zero-rate-target", () => ({ resolveWarmZeroRateLimit: vi.fn(async () => 100) }))
vi.mock("@/lib/vmware/soap", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/vmware/soap")>()
  // vmwareToolsState and the timeouts stay real.
  return {
    ...actual,
    soapLogin: vi.fn(), soapLogout: vi.fn(async () => {}), soapGetVmConfig: vi.fn(async () => "<vm/>"), parseVmConfig: vi.fn(),
    soapCreateSnapshot: vi.fn(), soapRemoveSnapshot: vi.fn(async () => {}), soapWaitForConsolidation: vi.fn(async () => true),
    soapFindSnapshotsByNamePrefix: vi.fn(async () => []), soapPowerOffVm: vi.fn(async () => {}),
    soapGetGuestIdentities: vi.fn(async () => new Map()), soapGetGuestStaticIpv4: vi.fn(async () => []),
  }
})
vi.mock("@/lib/vmware/cbt", () => ({
  cbtEligibility: vi.fn(() => ({ eligible: true })), soapEnableCbt: vi.fn(async () => {}), soapDisableCbt: vi.fn(async () => {}),
  queryAllChangedAreas: vi.fn(), soapGetSnapshotChangeIds: vi.fn(), soapGuestShutdown: vi.fn(async () => {}),
  soapWaitPoweredOff: vi.fn(async () => true), soapKeepAlive: vi.fn(async () => {}),
}))
vi.mock("@/lib/vmware/datastore-headroom", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/vmware/datastore-headroom")>()
  return { ...actual, parseVmDatastoreMors: vi.fn(() => []), soapGetDatastoreHeadroom: vi.fn(async () => []) }
})

import { executeSSH, type SSHExecOpts } from "@/lib/ssh/exec"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getTenantPrisma } from "@/lib/tenant"
import { getNodeSshEndpointForMigration } from "../pve-tasks"
import { reserveTargetVmid } from "../reserve-target-vmid"
import { allocateAndMapBlockVolume, type AllocateAndMapArgs, type AllocatedVolume } from "../pvesm-alloc"
import { checkVddkPreflight } from "./vddk-preflight"
import { resolveCopyPath } from "./copy-path"
import { checkNfcReachability } from "./nfc-reachability"
import { startVddkReader } from "./vddk-reader"
import { applyExtentsWithProgress } from "./apply"
import { attachDisksAndBoot, verifyWarmDiskIntegrity } from "./finish"
import { soapLogin, parseVmConfig, soapCreateSnapshot, soapGetGuestStaticIpv4, type EsxiVmConfig } from "@/lib/vmware/soap"
import { queryAllChangedAreas, soapGetSnapshotChangeIds } from "@/lib/vmware/cbt"
import { ZERO_MODE_OFFLOAD_MARKER } from "./target-provision"
import type { WarmMigrationConfig } from "./types"
import { runWarmMigration } from "./warm-pipeline"

// ── Fixtures ──

const GiB = 1024 ** 3
const MiB = 1024 * 1024
const NODE = "10.0.0.5"
const ZERO_SCRIPT_PREFIX = "sz=$(blockdev --getsize64"
/** Three SCSI disks of a Linux guest; the second one is the candidate for exclusion. */
const DISKS = [
  { label: "Hard disk 1", fileName: "[ds1] web01/web01.vmdk", capacityBytes: 40 * GiB, deviceKey: 2000 },
  { label: "Hard disk 2", fileName: "[ds1] web01/web01_1.vmdk", capacityBytes: 100 * GiB, deviceKey: 2001 },
  { label: "Hard disk 3", fileName: "[ds1] web01/web01_2.vmdk", capacityBytes: 20 * GiB, deviceKey: 2002 },
]

function makeVmConfig(): EsxiVmConfig {
  return {
    name: "web01", guestOS: "Debian GNU/Linux 12 (64-bit)", guestId: "debian12_64Guest",
    numCPU: 2, numCoresPerSocket: 2, sockets: 1, memoryMB: 4096, firmware: "bios", uuid: "4221aa55-0001",
    vmxVersion: "vmx-19", vmPathName: "[ds1] web01/web01.vmx", powerState: "poweredOn", committed: 0,
    disks: DISKS.map((d, i) => ({
      ...d, thinProvisioned: true, datastoreName: "ds1", relativePath: d.fileName.split("] ")[1],
      controllerType: "scsi", controllerKey: 1000, unitNumber: i,
    })),
    nics: [], snapshotCount: 0, toolsRunningStatus: "guestToolsRunning", changeTrackingEnabled: false,
  }
}

function makeConfig(overrides: Partial<WarmMigrationConfig> = {}): WarmMigrationConfig {
  return {
    sourceConnectionId: "conn-esxi", sourceVmId: "vm-101", targetConnectionId: "conn-pve", targetNode: "pve1",
    targetStorage: "vg-thick", networkBridge: "vmbr0", startAfterMigration: false, downtimeBudgetSec: 300, maxPasses: 3,
    ...overrides,
  }
}

// ── Scenario knobs (reset in beforeEach) ──

/** PVE type and free bytes of every storage the fake cluster knows. */
let cluster: Record<string, { type: string; avail: number }>
let sshCommands: string[]
let pveCalls: Array<{ path: string; method: string }>
let readerCounter: number
let snapCounter: number

async function sshRouter(_c: string, _h: unknown, command: string, _t?: number, opts?: SSHExecOpts) {
  sshCommands.push(command)
  if (command.includes("openssl s_client")) return { success: true, output: "SHA1 Fingerprint=46:8C:45:3B:1E:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88" }
  // Thick zero script: the array accepts the offload, nothing else to report.
  if (command.startsWith(ZERO_SCRIPT_PREFIX)) opts?.onData?.(`${ZERO_MODE_OFFLOAD_MARKER}\n`)
  // blkdiscard, reader sweep, pvesm free: plain success
  return { success: true, output: "" }
}

async function pveRouter(_conn: unknown, path: string, init?: { method?: string }) {
  pveCalls.push({ path, method: init?.method ?? "GET" })
  const storage = /^\/storage\/([^/]+)$/.exec(path)
  if (storage) return { type: cluster[decodeURIComponent(storage[1])]?.type }
  const status = /^\/nodes\/pve1\/storage\/([^/]+)\/status$/.exec(path)
  if (status) {
    const s = cluster[decodeURIComponent(status[1])]
    return { type: s?.type, avail: s?.avail }
  }
  if (path === "/nodes/pve1/qemu" && init?.method === "POST") return "UPID:pve1:0000ABCD:qmcreate:250:root@pam:"
  return {}
}

/** The job row, written through the tenant client job-control binds at registerJob. */
function makeFakePrisma() {
  const row: Record<string, any> = { status: "pending", logs: [] as any[], progress: 0 }
  return {
    row,
    migrationJob: {
      findUnique: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return row }),
      updateMany: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 } }),
    },
    connection: {
      findUnique: vi.fn(async () => ({ id: "conn-esxi", name: "esxi21", baseUrl: "https://10.42.0.21", apiTokenEnc: "enc", insecureTLS: true, type: "vmware" })),
    },
  }
}

let prisma: ReturnType<typeof makeFakePrisma>

const messages = () => (prisma.row.logs as Array<{ msg: string }>).map(l => l.msg)
const storageReads = () => pveCalls.filter(c => /^\/storage\//.test(c.path)).map(c => c.path)
const spaceReads = () => pveCalls.filter(c => /\/storage\/[^/]+\/status$/.test(c.path)).map(c => c.path)
const allocations = () => vi.mocked(allocateAndMapBlockVolume).mock.calls.map(c => [c[0].targetStorage, c[0].volName, c[0].sizeKB])
const zeroScripts = () => sshCommands.filter(c => c.startsWith(ZERO_SCRIPT_PREFIX))

/** Run the pipeline to its end; resolves with the error it threw, null on success. */
async function runToEnd(jobId: string, config: WarmMigrationConfig): Promise<Error | null> {
  try {
    await runWarmMigration(jobId, config, "tenant-test")
    return null
  } catch (e) {
    return e as Error
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  cluster = {
    "vg-thick": { type: "lvm", avail: 1000 * GiB },
    Ceph: { type: "rbd", avail: 1000 * GiB },
    "nfs-vm": { type: "nfs", avail: 1000 * GiB },
  }
  sshCommands = []
  pveCalls = []
  readerCounter = 0
  snapCounter = 0
  prisma = makeFakePrisma()

  vi.mocked(getTenantPrisma).mockReturnValue(prisma as any)
  vi.mocked(getConnectionById).mockResolvedValue({ id: "conn-pve", baseUrl: "https://pve.test:8006" } as any)
  vi.mocked(getNodeSshEndpointForMigration).mockResolvedValue(NODE)
  vi.mocked(reserveTargetVmid).mockResolvedValue(250)
  vi.mocked(executeSSH).mockImplementation(sshRouter as any)
  vi.mocked(pveFetch).mockImplementation(pveRouter as any)
  // The real allocation registers a slot in the pipeline's cleanup array.
  vi.mocked(allocateAndMapBlockVolume).mockImplementation(async (args: AllocateAndMapArgs) => {
    const slot: AllocatedVolume = { volumeId: `${args.targetStorage}:${args.volName}`, devicePath: `/dev/${args.targetStorage}/${args.volName}` }
    args.allocatedVolumes?.push(slot)
    return slot
  })
  vi.mocked(checkVddkPreflight).mockResolvedValue({ ok: true, missing: [], vddkLib: "/usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.9" })
  vi.mocked(resolveCopyPath).mockResolvedValue({ server: "10.42.0.21", nfcAddress: "10.42.0.21", direct: true, label: "vmk0 10.42.0.21 on esxi21", hostChanges: [] } as any)
  vi.mocked(checkNfcReachability).mockResolvedValue({ address: "10.42.0.21", ports: { 902: true, 443: true }, ok: true })
  vi.mocked(soapLogin).mockResolvedValue({
    baseUrl: "https://10.42.0.21", cookie: "c", insecureTLS: true, sessionManager: "ha-sessionmgr",
    propertyCollector: "ha-property-collector", rootFolder: "ha-folder-root", isVcenter: false, apiVersion: "8.0.3.0",
  })
  // A fresh copy per read: the pipeline filters vmConfig.disks in place.
  vi.mocked(parseVmConfig).mockImplementation(() => makeVmConfig())
  vi.mocked(soapCreateSnapshot).mockImplementation(async () => `snapshot-${++snapCounter}`)
  // The "*" baseline of the full pass reads the whole disk; every later
  // baseline finds nothing changed, so the first delta already fits the budget.
  vi.mocked(queryAllChangedAreas).mockImplementation(async (_s, _vm, _snap, _key, baseline, capacityBytes) =>
    baseline === "*" ? [{ offset: 0, length: capacityBytes }] : [])
  vi.mocked(soapGetSnapshotChangeIds).mockResolvedValue(new Map(DISKS.map(d => [d.deviceKey, `52 de ad/${d.deviceKey}`])))
  vi.mocked(startVddkReader).mockImplementation(async (_c, _ip, opts) => ({ nbdDev: `/dev/nbd${readerCounter++}`, sock: opts.sock, pwFile: opts.passwordFile }))
})

describe("runWarmMigration per-disk choices (#317 lot 2)", () => {
  it("leaves an excluded disk out of every step and lands each kept disk on its own storage", async () => {
    const err = await runToEnd("warm-disks-1", makeConfig({ disks: [{ index: 1, exclude: true }, { index: 2, targetStorage: "Ceph" }] }))

    expect(err).toBeNull()
    expect(prisma.row.status).toBe("completed")
    expect(messages()).toContain("Per-disk choices: storage disk 1->vg-thick, disk 3->Ceph; excluded disk 2")

    // sized on the kept disks only, one storage read and one free-space read per storage of the plan
    expect(prisma.row.totalDisks).toBe(2)
    expect(storageReads()).toEqual(["/storage/vg-thick", "/storage/Ceph"])
    expect(spaceReads()).toEqual(["/nodes/pve1/storage/vg-thick/status", "/nodes/pve1/storage/Ceph/status"])
    expect(messages()).toContain('Target storage "vg-thick": 1000.0 GB free, need 40.0 GB')
    expect(messages()).toContain('Target storage "Ceph": 1000.0 GB free, need 20.0 GB')

    // allocated on their own storage, numbered without a gap; the thick one zeroed under the cap, the rbd one discarded
    expect(allocations()).toEqual([["vg-thick", "vm-250-disk-0", (40 * GiB) / 1024], ["Ceph", "vm-250-disk-1", (20 * GiB) / 1024]])
    expect(zeroScripts()).toHaveLength(1)
    expect(zeroScripts()[0]).toContain("'/dev/vg-thick/vm-250-disk-0'")
    expect(zeroScripts()[0]).toContain(`cap=${100 * MiB}`)
    expect(sshCommands).toContain("blkdiscard '/dev/Ceph/vm-250-disk-1' 2>/dev/null || true")

    // device key 2001 and web01_1.vmdk belong to the excluded disk: never queried, opened, applied or verified
    expect(vi.mocked(queryAllChangedAreas).mock.calls.length).toBeGreaterThan(0)
    expect(vi.mocked(queryAllChangedAreas).mock.calls.map(c => c[3])).not.toContain(2001)
    expect(vi.mocked(startVddkReader).mock.calls.map(c => c[2].diskPath)).toEqual(["[ds1] web01/web01.vmdk", "[ds1] web01/web01_2.vmdk"])
    expect(vi.mocked(applyExtentsWithProgress).mock.calls.map(c => c[0].dev)).toEqual(["/dev/vg-thick/vm-250-disk-0", "/dev/Ceph/vm-250-disk-1"])
    expect(vi.mocked(verifyWarmDiskIntegrity).mock.calls.map(c => [c[0].diskIndex, c[0].dev])).toEqual([[0, "/dev/vg-thick/vm-250-disk-0"], [1, "/dev/Ceph/vm-250-disk-1"]])
    // two disks attached; efidisk0 / tpmstate0 keep the job's storage
    expect(attachDisksAndBoot).toHaveBeenCalledWith(expect.objectContaining({ diskCount: 2, targetStorage: "vg-thick" }))
    expect(prisma.row.totalBytes).toBe(BigInt(60 * GiB))
  })

  it("refuses a plan that sends a disk to a file-based storage, naming the storage and the disk, before anything is created", async () => {
    const err = await runToEnd("warm-disks-2", makeConfig({ disks: [{ index: 2, targetStorage: "nfs-vm" }] }))

    expect(err?.message).toBe('Warm migration requires a block-storage target (LVM/LVM-thin/ZFS/Ceph RBD); "nfs-vm" is file-based (nfs) and would hold disk 3. Pick a block storage or use a cold migration.')
    expect(prisma.row.status).toBe("failed")
    expect(allocateAndMapBlockVolume).not.toHaveBeenCalled()
    expect(pveCalls.some(c => c.path === "/nodes/pve1/qemu" && c.method === "POST")).toBe(false)
  })

  it("keeps today's refusal wording when the job's one storage is file-based", async () => {
    cluster["vg-thick"].type = "dir"

    const err = await runToEnd("warm-disks-3", makeConfig())

    expect(err?.message).toBe('Warm migration requires a block-storage target (LVM/LVM-thin/ZFS/Ceph RBD); "vg-thick" is file-based (dir). Pick a block storage or use a cold migration.')
    expect(messages().some(m => m.startsWith("Per-disk choices"))).toBe(false)
  })

  it("checks the free space of every storage of the plan and names the one that is short", async () => {
    cluster.Ceph.avail = 10 * GiB

    const err = await runToEnd("warm-disks-4", makeConfig({ disks: [{ index: 2, targetStorage: "Ceph" }] }))

    expect(err?.message).toBe('Insufficient disk space on "Ceph": 10.0 GB free, need 20.0 GB plus a 10% margin. Free up space or pick another storage.')
    // the default storage holds disks 1 and 2 (140 GB) and was checked first
    expect(messages()).toContain('Target storage "vg-thick": 1000.0 GB free, need 140.0 GB')
    expect(allocateAndMapBlockVolume).not.toHaveBeenCalled()
  })

  it("without per-disk choices every disk goes to the job's storage with one check each, as before", async () => {
    const err = await runToEnd("warm-disks-5", makeConfig())

    expect(err).toBeNull()
    expect(prisma.row.status).toBe("completed")
    expect(messages().some(m => m.startsWith("Per-disk choices"))).toBe(false)
    expect(storageReads()).toEqual(["/storage/vg-thick"])
    expect(spaceReads()).toEqual(["/nodes/pve1/storage/vg-thick/status"])
    expect(messages()).toContain('Target storage "vg-thick": 1000.0 GB free, need 160.0 GB')
    expect(allocations().map(a => a[0])).toEqual(["vg-thick", "vg-thick", "vg-thick"])
    expect(zeroScripts()).toHaveLength(3)
    expect(vi.mocked(verifyWarmDiskIntegrity).mock.calls.map(c => c[0].diskIndex)).toEqual([0, 1, 2])
    expect(attachDisksAndBoot).toHaveBeenCalledWith(expect.objectContaining({ diskCount: 3 }))
  })

  it("ignores a mapping for a disk the source no longer has and says so", async () => {
    const err = await runToEnd("warm-disks-6", makeConfig({ disks: [{ index: 4, targetStorage: "Ceph" }] }))

    expect(err).toBeNull()
    expect(messages()).toContain("Per-disk choices: ignored mapping for missing disk 5")
    expect(storageReads()).toEqual(["/storage/vg-thick"])
    expect(attachDisksAndBoot).toHaveBeenCalledWith(expect.objectContaining({ diskCount: 3 }))
  })
})

describe("runWarmMigration guest conversion at cutover (#1000)", () => {
  const efiVm = () => ({ ...makeVmConfig(), firmware: "efi", nics: [{ label: "n", type: "Vmxnet3", macAddress: "00:50:56:00:00:09", network: "VM Network", pciSlot: 192 }] })
  const v2vLog = (drivers: boolean) => [
    JSON.stringify({ type: "message", message: "Converting Rocky Linux 9.8 (Blue Onyx) (rocky9) to run on KVM" }),
    JSON.stringify({ type: "info", message: drivers ? "This guest has virtio drivers installed." : "This guest does not have virtio drivers installed." }),
  ].join("\n")

  /** The node answers the conversion like pve1 did on the lab. */
  function conversionNode(drivers: boolean, prereqs = "v2v-in-place\n") {
    vi.mocked(executeSSH).mockImplementation(async (c: string, h: any, command: string, t?: number, opts?: SSHExecOpts) => {
      if (command.startsWith("test -x /usr/bin/virt-v2v-in-place")) { sshCommands.push(command); return { success: true, output: prereqs } }
      if (command.startsWith("nohup bash")) { sshCommands.push(command); return { success: true, output: "777\n" } }
      if (command.startsWith("cat '/tmp/proxcenter-convert-") && command.includes("/commit-exit")) return { success: true, output: "ok\n" }
      if (command.startsWith("cat '/tmp/proxcenter-convert-") && command.includes("/exit")) return { success: true, output: "0\n" }
      if (command.startsWith("cat '/tmp/proxcenter-convert-")) return { success: true, output: v2vLog(drivers) }
      return sshRouter(c, h, command, t, opts)
    })
  }
  const attach = () => vi.mocked(attachDisksAndBoot).mock.calls[0][0]

  it("converts the guest with the source off and attaches VirtIO SCSI disks and VirtIO NICs", async () => {
    vi.mocked(parseVmConfig).mockImplementation(() => efiVm() as any)
    conversionNode(true)

    const err = await runToEnd("warm-conv-1", makeConfig())

    expect(err).toBeNull()
    expect(sshCommands.some(c => c.startsWith("nohup bash") && c.includes("virt-v2v-in-place"))).toBe(true)
    // the guest's interface names are pinned in the same overlays: the NIC was ens192 on vSphere
    const launch = sshCommands.find(c => c.startsWith("nohup bash"))!
    const netpin = Buffer.from(/([A-Za-z0-9+/=]{20,})\W+\| base64 -d > "\$D\/netpin\.sh"/.exec(launch)![1], "base64").toString()
    expect(netpin).toContain("NICS='00:50:56:00:00:09 ens192'")
    // overlays on the three copied volumes, committed once the drivers are in
    const commit = sshCommands.find(c => c.startsWith("nohup bash") && c.includes("qemu-img commit"))!
    expect(commit).toContain("/tmp/proxcenter-convert-warm-conv-1")
    expect(commit.match(/qemu-img commit -q "\$D\/disk\d\.qcow2"/g)).toHaveLength(3)
    expect(messages().some(m => /^Guest converted in \d+s \(Rocky Linux 9\.8 \(Blue Onyx\)\)/.test(m))).toBe(true)
    expect(attach()).toMatchObject({ diskSlots: ["scsi0", "scsi1", "scsi2"], bootDiskSlot: "scsi0", nets: { net0: "virtio,bridge=vmbr0,macaddr=00:50:56:00:00:09" } })
    // the phases the dialogs render as section headers, in order
    const steps = (prisma.row.logs as Array<{ level: string; step?: string }>).filter(l => l.level === "step").map(l => l.step)
    expect(steps).toEqual(["planning", "prepare", "full_copy", "delta", "cutover", "verify", "conversion", "finish"])
  })

  it("keeps the compatible hardware and the copied disks when the conversion installs no driver", async () => {
    vi.mocked(parseVmConfig).mockImplementation(() => efiVm() as any)
    conversionNode(false)

    expect(await runToEnd("warm-conv-2", makeConfig())).toBeNull()

    expect(sshCommands.some(c => c.includes("qemu-img commit"))).toBe(false)
    expect(messages()).toContain("Guest conversion not applied: virt-v2v could not install the VirtIO drivers in this guest. The copied disks are unchanged and the guest keeps the hardware it boots on without new drivers (SATA disks and e1000 NICs for Windows, a SATA boot disk for UEFI guests)")
    expect(attach().bootDiskSlot).toBe("sata0")
    expect(attach()).not.toHaveProperty("nets")
  })

  it("follows the choice made in the cutover dialog over the launch value", async () => {
    vi.mocked(parseVmConfig).mockImplementation(() => efiVm() as any)
    conversionNode(true)
    // The cutover route wrote the operator's "no" into the job row.
    prisma.row.config = { convertGuest: false }

    expect(await runToEnd("warm-conv-3", makeConfig({ convertGuest: true }))).toBeNull()

    expect(sshCommands.some(c => c.startsWith("nohup bash"))).toBe(false)
    expect(messages()).toContain("Guest conversion not requested for this cutover: the guest keeps the hardware it boots on without new drivers")
    expect(attach().bootDiskSlot).toBe("sata0")
  })

  it("reads a Windows guest's static IPv4 before the shutdown and has virt-v2v set it again (#1000 follow-up)", async () => {
    const winVm = () => ({ ...efiVm(), guestId: "windows2019srvNext_64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)" })
    vi.mocked(parseVmConfig).mockImplementation(() => winVm() as any)
    vi.mocked(soapGetGuestStaticIpv4).mockResolvedValue([{ mac: "00:50:56:00:00:09", address: "10.42.0.239", prefixLength: 24, gateway: "10.42.0.1", dns: ["1.1.1.1"], extraAddresses: 0 }])
    conversionNode(true, "v2v-in-place\nvirtio-win\nsrvany\n")

    expect(await runToEnd("warm-conv-win", makeConfig())).toBeNull()

    expect(messages()).toContain("Guest network: static IPv4 configuration read from VMware Tools for 00:50:56:00:00:09 (10.42.0.239/24)")
    expect(sshCommands.find(c => c.startsWith("nohup bash"))).toContain("00:50:56:00:00:09:ip:10.42.0.239,10.42.0.1,24,1.1.1.1")
    expect(messages().some(m => m.startsWith("Guest network: the static IPv4 configuration of 00:50:56:00:00:09"))).toBe(true)
  })

  it("tells the operator to set the Windows static IP again when the guest is not converted", async () => {
    vi.mocked(parseVmConfig).mockImplementation(() => ({ ...efiVm(), guestId: "windows2019srvNext_64Guest", guestOS: "Microsoft Windows Server 2022 (64-bit)" }) as any)
    vi.mocked(soapGetGuestStaticIpv4).mockResolvedValue([{ mac: "00:50:56:00:00:09", address: "10.42.0.239", prefixLength: 24, dns: [], extraAddresses: 0 }])

    expect(await runToEnd("warm-conv-win-off", makeConfig({ convertGuest: false }))).toBeNull()

    expect(messages()).toContain("Guest network: Windows sees a new network adapter on Proxmox and the guest was not converted, so its static IPv4 configuration (10.42.0.239/24) must be set again from the console")
  })

  it("applies the review step's forced bus without conversion", async () => {
    vi.mocked(parseVmConfig).mockImplementation(() => efiVm() as any)

    expect(await runToEnd("warm-conv-4", makeConfig({ convertGuest: false, disks: [{ index: 0, bus: "scsi" }] }))).toBeNull()

    expect(messages()).toContain("Per-disk choices: bus disk 1->SCSI")
    expect(attach()).toMatchObject({ diskSlots: ["scsi0", "scsi1", "scsi2"], bootDiskSlot: "scsi0" })
  })

  const ws2025 = () => ({ ...efiVm(), guestId: "windows2022srvNext_64Guest", guestOS: "Microsoft Windows Server 2025 (64-bit)" })
  const virtioChoices = { disks: [{ index: 1, bus: "scsi" as const }], nics: [{ index: 0, bridge: "vmbr0", model: "virtio" }] }

  it("skips the conversion of a Windows the node's virt-v2v does not know and drops the VirtIO choices (#1173)", async () => {
    vi.mocked(parseVmConfig).mockImplementation(() => ws2025() as any)
    conversionNode(true, "v2v-in-place\nvirtio-win\nsrvany\nv2v-version=2.6.0\nv2v-probed\n")

    expect(await runToEnd("warm-conv-2k25", makeConfig(virtioChoices))).toBeNull()

    expect(sshCommands.some(c => c.startsWith("nohup bash"))).toBe(false)
    expect(messages().some(m => m.startsWith("Guest conversion not applied: virt-v2v 2.6.0 on this node does not support Windows Server 2025 (support starts with virt-v2v 2.7.2)"))).toBe(true)
    expect(messages().find(m => m.startsWith("The VirtIO hardware"))).toBe("The VirtIO hardware chosen for this guest needs the drivers the conversion did not install, so it is replaced by hardware Windows has drivers for: Disk 2 scsi1 → sata1, net0 virtio → e1000")
    expect(attach()).toMatchObject({ diskSlots: ["sata0", "sata1", "sata2"], bootDiskSlot: "sata0", nets: { net0: "e1000,bridge=vmbr0,macaddr=00:50:56:00:00:09" } })
    expect(messages().some(m => m.startsWith("Windows has no VirtIO driver yet"))).toBe(false)
  })

  it("keeps the VirtIO choices when the conversion was not requested, and says what Windows does not see (#1173)", async () => {
    vi.mocked(parseVmConfig).mockImplementation(() => ws2025() as any)

    expect(await runToEnd("warm-conv-2k25-off", makeConfig({ ...virtioChoices, convertGuest: false }))).toBeNull()

    expect(attach().diskSlots).toEqual(["sata0", "scsi1", "sata1"])
    expect(attach()).not.toHaveProperty("nets")
    expect(messages()).toContain("Windows has no VirtIO driver yet and does not see scsi1, net0: install virtio-win-guest-tools.exe from the VirtIO ISO in the guest")
  })
})

describe("runWarmMigration EL10 CPU level (#1000)", () => {
  it("warns at planning when an EL10 guest is bound for a CPU type below x86-64-v3, and keeps the choice", async () => {
    vi.mocked(parseVmConfig).mockImplementation(() => ({ ...makeVmConfig(), guestId: "rhel10_64Guest", guestOS: "Red Hat Enterprise Linux 10 (64-bit)" }) as any)
    expect(await runToEnd("warm-el10-1", makeConfig({ convertGuest: false }))).toBeNull()
    expect(messages().some(m => m.startsWith("This guest is an EL10 (RHEL 10 family), built for x86-64-v3: with the x86-64-v2-AES CPU type"))).toBe(true)
  })

  it("stays quiet on x86-64-v3", async () => {
    vi.mocked(parseVmConfig).mockImplementation(() => ({ ...makeVmConfig(), guestId: "rhel10_64Guest", guestOS: "Red Hat Enterprise Linux 10 (64-bit)" }) as any)
    expect(await runToEnd("warm-el10-2", makeConfig({ convertGuest: false, cpuType: "x86-64-v3" }))).toBeNull()
    expect(messages().some(m => m.startsWith("This guest is an EL10"))).toBe(false)
  })
})

describe("runWarmMigration on a vCenter source the node cannot reach (roadmap#175)", () => {
  const VC = "vcenter.corp.local"
  beforeEach(() => {
    vi.mocked(resolveCopyPath).mockResolvedValue({ server: VC, nfcAddress: "10.42.0.22", device: "vmk0", direct: false, label: "vmk0 10.42.0.22 (management) on esxi22", hostChanges: [] } as any)
    vi.mocked(checkNfcReachability).mockResolvedValue({ address: "10.42.0.22", ports: { 902: true }, ok: true, vcenter: { host: VC, resolved: true, open: true } })
  })

  it("probes the vCenter on 443 with the adapter, and reads its certificate from the node", async () => {
    expect(await runToEnd("warm-vc-1", makeConfig())).toBeNull()
    expect(checkNfcReachability).toHaveBeenCalledWith("conn-pve", NODE, "10.42.0.22", [902], VC)
    expect(messages()).toContain(`Copy network: vmk0 10.42.0.22 (management) on esxi22, port 902 reachable from pve1 (VDDK connects through the vCenter ${VC}, reachable on 443)`)
    expect(sshCommands.find(c => c.includes("openssl s_client"))).toContain(`-connect '${VC}:443' 2>&1`)
    expect(vi.mocked(startVddkReader).mock.calls[0][2]).toMatchObject({ server: VC, thumbprint: "46:8C:45:3B:1E:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88" })
  })

  it("stops at planning, before anything is created, when the node cannot reach the vCenter", async () => {
    vi.mocked(checkNfcReachability).mockResolvedValue({ address: "10.42.0.22", ports: { 902: true }, ok: false, vcenter: { host: VC, resolved: false, open: false } })
    const err = await runToEnd("warm-vc-2", makeConfig())
    expect(err?.message).toBe(`The Proxmox node cannot resolve the vCenter name ${VC}, which the VDDK on the node logs in to: add it to the node's DNS or /etc/hosts.`)
    expect(allocateAndMapBlockVolume).not.toHaveBeenCalled()
  })

  it("names the cause the node's OpenSSL gives instead of a parse error", async () => {
    vi.mocked(executeSSH).mockImplementation((async (c: string, h: unknown, command: string, t?: number, o?: SSHExecOpts) => command.includes("openssl s_client")
      ? { success: true, output: "s_client-exit=1\n802725A7D5720000:error:8000006F:system library:BIO_connect:Connection refused:../crypto/bio/bio_sock2.c:183:calling connect()\n" }
      : sshRouter(c, h, command, t, o)) as any)
    const err = await runToEnd("warm-vc-3", makeConfig())
    expect(err?.message).toBe(`Could not read the TLS certificate of ${VC}:443 from the Proxmox node pve1, which the VDDK needs to connect: ${VC} refused the connection on port 443: open the firewall from the node to ${VC}`)
    expect(allocateAndMapBlockVolume).not.toHaveBeenCalled()
  })

  it("reports an SSH failure of the certificate read as such", async () => {
    vi.mocked(executeSSH).mockImplementation((async (c: string, h: unknown, command: string, t?: number, o?: SSHExecOpts) => command.includes("openssl s_client")
      ? { success: false, error: "Command timed out" }
      : sshRouter(c, h, command, t, o)) as any)
    const err = await runToEnd("warm-vc-4", makeConfig())
    expect(err?.message).toBe(`Could not read the TLS certificate of ${VC} from the Proxmox node pve1: Command timed out`)
  })
})
