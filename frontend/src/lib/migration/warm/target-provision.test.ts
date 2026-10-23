import { describe, it, expect, vi, beforeEach } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// provisionBlockTargets composes the allocation helper, the node SSH channel
// and the job row; each is replaced so the test can read which disk went to
// which storage, which one was zeroed and how the progress was weighted.
vi.mock("@/lib/ssh/exec", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() } // keep the real shellEscape
})
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))
vi.mock("../pve-tasks", () => ({ waitForPveTask: vi.fn() }))
vi.mock("../pvesm-alloc", async importOriginal => {
  const actual = await importOriginal<typeof import("../pvesm-alloc")>()
  return { ...actual, allocateAndMapBlockVolume: vi.fn() } // nextFreeDiskName stays real
})
// Promises, not bare vi.fn(): the progress path chains `.catch` on the log write.
vi.mock("./job-control", () => ({ updateJob: vi.fn(async () => {}), updateJobLive: vi.fn(async () => {}), appendLog: vi.fn(async () => {}) }))

import { executeSSH, type SSHExecOpts } from "@/lib/ssh/exec"
import { allocateAndMapBlockVolume, type AllocateAndMapArgs, type AllocatedVolume } from "../pvesm-alloc"
import { appendLog, updateJob, updateJobLive } from "./job-control"
import { buildThickZeroScript, provisionBlockTargets, ZERO_MODE_OFFLOAD_MARKER, type ProvisionDisk } from "./target-provision"

const GiB = 1024 ** 3
const MiB = 1024 * 1024
const ZERO_SCRIPT_PREFIX = "sz=$(blockdev --getsize64"

let sshCommands: string[]

const devOf = (storage: string, volName: string) => `/dev/${storage}/${volName}`
const logs = () => vi.mocked(appendLog).mock.calls.map(c => c[1])
const zeroScripts = () => sshCommands.filter(c => c.startsWith(ZERO_SCRIPT_PREFIX))

async function run(disks: ProvisionDisk[], zeroRateLimitMBps?: number) {
  const allocatedVolumes: AllocatedVolume[] = []
  const targetDev = await provisionBlockTargets({
    jobId: "job-1", connectionId: "conn-pve", nodeIp: "10.0.0.5", targetVmid: 250,
    shellConf: {}, disks, allocatedVolumes, zeroRateLimitMBps,
  })
  return { targetDev, allocatedVolumes }
}

beforeEach(() => {
  vi.clearAllMocks()
  sshCommands = []
  // The real allocation registers a slot in the caller's cleanup array.
  vi.mocked(allocateAndMapBlockVolume).mockImplementation(async (args: AllocateAndMapArgs) => {
    const slot: AllocatedVolume = { volumeId: `${args.targetStorage}:${args.volName}`, devicePath: devOf(args.targetStorage, args.volName) }
    args.allocatedVolumes?.push(slot)
    return slot
  })
  vi.mocked(executeSSH).mockImplementation(async (_c, _h, command: string, _t?: number, opts?: SSHExecOpts) => {
    sshCommands.push(command)
    if (command.startsWith(ZERO_SCRIPT_PREFIX)) {
      // The script names its mode on the first slice, then reports after every slice.
      opts?.onData?.(`${ZERO_MODE_OFFLOAD_MARKER}\n`)
      opts?.onData?.(`${10 * GiB} bytes copied, 10.000 s\n`)
    }
    return { success: true, output: "" }
  })
})

describe("provisionBlockTargets with one storage per disk (#317 lot 2)", () => {
  it("allocates each disk on its own storage and zeroes only the thick one, under the cap", async () => {
    const { targetDev, allocatedVolumes } = await run([
      { key: 2000, capacityBytes: 10 * GiB, storage: "Ceph", storageType: "rbd" },
      { key: 2001, capacityBytes: 20 * GiB, storage: "vg-thick", storageType: "lvm" },
    ], 100)

    // one allocation per disk, on the disk's storage, numbered across storages without a gap
    expect(vi.mocked(allocateAndMapBlockVolume).mock.calls.map(c => [c[0].targetStorage, c[0].volName, c[0].sizeKB])).toEqual([
      ["Ceph", "vm-250-disk-0", (10 * GiB) / 1024],
      ["vg-thick", "vm-250-disk-1", (20 * GiB) / 1024],
    ])
    expect(allocatedVolumes.map(v => v.volumeId)).toEqual(["Ceph:vm-250-disk-0", "vg-thick:vm-250-disk-1"])
    expect(targetDev).toEqual(new Map([[2000, "/dev/Ceph/vm-250-disk-0"], [2001, "/dev/vg-thick/vm-250-disk-1"]]))
    expect(updateJob).toHaveBeenCalledWith("job-1", "preparing_disks")

    // the rbd volume gets one discard and never the zero script; the lvm one gets the script, paced to the cap
    expect(sshCommands.filter(c => c.startsWith("blkdiscard "))).toEqual(["blkdiscard '/dev/Ceph/vm-250-disk-0' 2>/dev/null || true"])
    expect(zeroScripts()).toHaveLength(1)
    expect(zeroScripts()[0]).toContain("blockdev --getsize64 '/dev/vg-thick/vm-250-disk-1'")
    expect(zeroScripts()[0]).toContain(`cap=${100 * MiB}`)
    expect(zeroScripts()[0]).not.toContain("/dev/Ceph/")

    // the zeroing lines name disk 1 only; the target line of every disk carries its storage in the volume id
    expect(logs().some(m => m.startsWith("Disk 2: zeroing thick target /dev/vg-thick/vm-250-disk-1 (20.0 GB)") && m.includes("Rate limit 100 MB/s"))).toBe(true)
    expect(logs().some(m => /^Disk 2: zeroed thick target \/dev\/vg-thick\/vm-250-disk-1 in .*limit 100 MB\/s\)$/.test(m))).toBe(true)
    expect(logs().some(m => m.startsWith("Disk 1: zero"))).toBe(false)
    expect(logs()).toContain("Disk 1: target Ceph:vm-250-disk-0 → /dev/Ceph/vm-250-disk-0 (10.0 GB)")
    expect(logs()).toContain("Disk 2: target vg-thick:vm-250-disk-1 → /dev/vg-thick/vm-250-disk-1 (20.0 GB)")
  })

  it("weights the 0 to 10 progress by the bytes actually zeroed: a disk on a thin pool does not count", async () => {
    await run([
      { key: 2000, capacityBytes: 10 * GiB, storage: "Ceph", storageType: "rbd" },
      { key: 2001, capacityBytes: 20 * GiB, storage: "vg-thick", storageType: "lvm" },
    ])
    // 10 of the 20 GiB being zeroed is half the window; counting the discarded
    // disk as zeroed would have read (10 + 10) / 30, i.e. 7 %
    expect(updateJobLive).toHaveBeenCalledTimes(1)
    expect(updateJobLive).toHaveBeenCalledWith("job-1", "preparing_disks", expect.objectContaining({ progress: 5 }))
  })

  it("keeps the single thin storage shape the XCP-ng engine sends: discards only, no zeroing line, no progress", async () => {
    const { allocatedVolumes } = await run([
      { key: 0, capacityBytes: 10 * GiB, storage: "DatastoreVM", storageType: "zfspool" },
      { key: 1, capacityBytes: 20 * GiB, storage: "DatastoreVM", storageType: "zfspool" },
    ])
    expect(allocatedVolumes.map(v => v.volumeId)).toEqual(["DatastoreVM:vm-250-disk-0", "DatastoreVM:vm-250-disk-1"])
    expect(sshCommands).toEqual([
      "blkdiscard '/dev/DatastoreVM/vm-250-disk-0' 2>/dev/null || true",
      "blkdiscard '/dev/DatastoreVM/vm-250-disk-1' 2>/dev/null || true",
    ])
    expect(updateJobLive).not.toHaveBeenCalled()
    expect(logs().some(m => m.includes("zero"))).toBe(false)
  })

  it("on one thick storage zeroes every disk and spreads the progress over all of them, as before", async () => {
    await run([
      { key: 0, capacityBytes: 10 * GiB, storage: "vg-thick", storageType: "lvm" },
      { key: 1, capacityBytes: 20 * GiB, storage: "vg-thick", storageType: "lvm" },
    ])
    expect(zeroScripts()).toHaveLength(2)
    // disk 0 reports 10 of 30 GiB (3 %); disk 1 reports 10 GiB on top of the finished disk 0, 20 of 30 (7 %)
    expect(vi.mocked(updateJobLive).mock.calls.map(c => c[2]?.progress)).toEqual([3, 7])
    expect(logs().filter(m => m.startsWith("Disk 1: zeroing") || m.startsWith("Disk 2: zeroing"))).toHaveLength(2)
  })

  it("fails hard when a thick target cannot be zeroed, with the device and the node's reason", async () => {
    vi.mocked(executeSSH).mockImplementation(async (_c, _h, command: string) => {
      sshCommands.push(command)
      if (command.startsWith(ZERO_SCRIPT_PREFIX)) return { success: false, output: "blkdiscard: BLKZEROOUT ioctl failed: Input/output error", error: "Exit code 1" }
      return { success: true, output: "" }
    })
    await expect(run([{ key: 0, capacityBytes: 10 * GiB, storage: "vg-thick", storageType: "lvm" }]))
      .rejects.toThrow(/Failed to zero thick target \/dev\/vg-thick\/vm-250-disk-0 .*Input\/output error/)
  })
})

describe("buildThickZeroScript quoting", () => {
  it("keeps a device path with shell characters one literal word, in and out of the error messages", () => {
    const canary = join(tmpdir(), `zero-script-canary-${process.pid}`)
    const dev = `/dev/vg thick/vm $(touch ${canary}) \`id\``
    const script = buildThickZeroScript(dev, 2)
    // blockdev fails: the script must report the raw device name and exit 1 without expanding it.
    const out = spawnSync("bash", ["-c", `blockdev() { printf '%s\\n' "$@" >&2; return 1; }\n${script}`], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" } })
    expect(out.status).toBe(1)
    expect(out.stdout.trim()).toBe(`zero-error: cannot read the size of ${dev}`)
    expect(out.stderr.trim()).toBe(`--getsize64\n${dev}`)
    expect(existsSync(canary)).toBe(false)
  })
})
