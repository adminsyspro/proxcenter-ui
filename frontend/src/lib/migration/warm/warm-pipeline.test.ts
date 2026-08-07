import { describe, it, expect, beforeEach } from "vitest"
import { planPasses, buildThickZeroScript, scaleWarmProgress, checksumDiskWindows, ZERO_PARALLEL_CHUNKS, markVolumesCopied, requestWarmCutover, __isCutoverRequestedForTest, __awaitOperatorCutoverForTest } from "./warm-pipeline"
import { parseDdProgress } from "./dd-progress"
import { volumesToFree, volumesToKeep, type AllocatedVolume } from "../pvesm-alloc"
import { prismaTest, truncate } from "../../../__tests__/setup/prisma-test"

const GiB = 1024 ** 3
const MiB = 1024 * 1024
const cfg = { downtimeBudgetSec: 300, maxPasses: 5, shutdownSec: 20, bootSec: 30 }

describe("planPasses", () => {
  it("stops at cutover once the projected downtime fits the budget", () => {
    const actions = planPasses(
      [{ deltaBytes: 50 * GiB, throughputBytesPerSec: 100 * MiB },
       { deltaBytes: 30 * MiB, throughputBytesPerSec: 100 * MiB }],
      cfg)
    expect(actions[actions.length - 1]).toEqual({ action: "cutover", projectedDowntimeSec: 50 })
  })

  it("cuts over immediately when the very first delta already fits the budget", () => {
    const actions = planPasses([{ deltaBytes: 10 * MiB, throughputBytesPerSec: 100 * MiB }], cfg)
    expect(actions).toEqual([{ action: "cutover", projectedDowntimeSec: 50 }])
  })

  it("escalates to an operator gate when max passes is reached without meeting the budget", () => {
    // every pass stays far above budget -> never auto-cutover, hit the safety cap
    const stats = Array.from({ length: 5 }, () => ({ deltaBytes: 50 * GiB, throughputBytesPerSec: 100 * MiB }))
    const actions = planPasses(stats, cfg)
    expect(actions[actions.length - 1].action).toBe("operator-gate")
  })

  it("keeps issuing delta passes while above budget and below the cap", () => {
    const stats = Array.from({ length: 3 }, () => ({ deltaBytes: 50 * GiB, throughputBytesPerSec: 100 * MiB }))
    const actions = planPasses(stats, cfg)
    expect(actions.every(a => a.action === "delta")).toBe(true)
    expect(actions).toHaveLength(3)
  })
})

describe("buildThickZeroScript", () => {
  const dev = "/dev/vg-ld6-isp/vm-116-disk-1"

  it("queries the exact device size and bounds every zero stream to its range (#445)", () => {
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain(`blockdev --getsize64 '${dev}'`)
    // one bounded `head -c … | dd` per parallel range — never an unbounded dd
    expect(cmd.match(/head -c /g)).toHaveLength(ZERO_PARALLEL_CHUNKS)
  })

  it("does NOT emit the unbounded dd that ENOSPCs past end-of-device (#445)", () => {
    // A bare `dd if=/dev/zero of=DEV bs=4M oflag=direct` with no count fills the
    // device, then writes one block past the end -> ENOSPC -> exit 1, even after
    // a full zero. Guard that the broken form never comes back.
    const cmd = buildThickZeroScript(dev)
    expect(cmd).not.toMatch(/dd if=\/dev\/zero of=/)
  })

  it("prefers blkdiscard -z and only streams zeros on its failure", () => {
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain(`blkdiscard -z '${dev}' 2>&1`)
    // blkdiscard first; the parallel dd streams are the fallback, not the primary path
    expect(cmd.indexOf("blkdiscard -z")).toBeLessThan(cmd.indexOf("head -c"))
  })

  it("surfaces WHY the offload was refused with a parseable marker (#606)", () => {
    // Today the blkdiscard error is only visible when the whole script fails;
    // when the fallback succeeds the reason for the slow path is silently lost.
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain('echo "blkdiscard-refused: $out"')
  })

  it("splits the device into equal 4 MiB-aligned ranges, remainder on the last (#606)", () => {
    // Queue depth 1 is why the field run sustained only 359 MiB/s on an FC
    // array that reaches 1.9 GB/s with concurrency: one dd per range, in parallel.
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain(`per=$((sz / ${ZERO_PARALLEL_CHUNKS} / 4194304 * 4194304))`)
    for (let i = 0; i < ZERO_PARALLEL_CHUNKS - 1; i++) {
      expect(cmd).toContain(`head -c "$per" /dev/zero | dd of='${dev}'`)
      expect(cmd).toContain(`seek=$((${i} * per))`)
      expect(cmd).toContain(`2>"$t/z${i}" & p${i}=$!`)
      expect(cmd).toContain(`wait $p${i} || fail=1`)
    }
    // the last range takes the remainder, so the whole device is covered
    const last = ZERO_PARALLEL_CHUNKS - 1
    expect(cmd).toContain(`head -c "$((sz - ${last} * per))" /dev/zero`)
    expect(cmd).toContain(`seek=$((${last} * per))`)
    expect(cmd).toContain(`wait $p${last} || fail=1`)
  })

  it("honours a custom chunk count, remainder included", () => {
    const cmd = buildThickZeroScript(dev, 2)
    expect(cmd).toContain("per=$((sz / 2 / 4194304 * 4194304))")
    expect(cmd).toContain('head -c "$per" /dev/zero')
    expect(cmd).toContain('head -c "$((sz - 1 * per))" /dev/zero')
    expect(cmd).not.toContain("$t/z2")
  })

  it("degenerates to one bounded full-device stream with a single chunk", () => {
    const cmd = buildThickZeroScript(dev, 1)
    expect(cmd.match(/head -c /g)).toHaveLength(1)
    expect(cmd).toContain('head -c "$((sz - 0 * per))" /dev/zero')
    expect(cmd).toContain("seek=$((0 * per))")
  })

  it("aggregates the per-range progress into ONE line in dd's own format", () => {
    // The poller line must be consumable by parseDdProgress unchanged, so the
    // caller gets live bytes for the progress bar and the SSH stream stays alive
    // (feeding the same inactivity guard as the copy).
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain('echo "$b bytes copied, $(($(date +%s)-start)) s"')
    const sample = 'echo "$b bytes copied, $(($(date +%s)-start)) s"'
      .replace('$b', "3221225472").replace("$(($(date +%s)-start))", "120")
      .replace(/^echo "/, "").replace(/"$/, "")
    expect(parseDdProgress(sample)).toEqual({ bytes: 3221225472, seconds: 120, bytesPerSec: 3221225472 / 120 })
  })

  it("keeps O_DIRECT with full 4 MiB pipe blocks and byte-exact seeks", () => {
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain("bs=4M iflag=fullblock oflag=seek_bytes,direct conv=notrunc status=progress")
  })

  it("single-quotes the device in every write/read position", () => {
    const cmd = buildThickZeroScript(dev)
    expect(cmd).toContain(`blockdev --getsize64 '${dev}'`)
    expect(cmd).toContain(`blkdiscard -z '${dev}'`)
    expect(cmd).toContain(`dd of='${dev}'`)
  })

  it("escapes an embedded single quote in the device path", () => {
    const cmd = buildThickZeroScript("/dev/x'y")
    expect(cmd).toContain(`'/dev/x'\\''y'`)
  })
})

describe("scaleWarmProgress", () => {
  // Locked scale: preparing_disks 0→10, full_copy 10→80, deltas 80→95, cutover+ 95→100.
  it("pins the phase boundaries of the locked scale", () => {
    expect(scaleWarmProgress(0, 10, 0, 1000)).toBe(0)
    expect(scaleWarmProgress(0, 10, 1000, 1000)).toBe(10)
    expect(scaleWarmProgress(10, 80, 500, 1000)).toBe(45)
  })

  it("clamps an overshooting numerator to the top of the window", () => {
    // aligned/merged extents can apply a few more bytes than the raw CBT sum
    expect(scaleWarmProgress(10, 80, 2000, 1000)).toBe(80)
  })

  it("never goes below the bottom of the window", () => {
    expect(scaleWarmProgress(80, 95, -5, 1000)).toBe(80)
  })

  it("treats an empty phase as already complete", () => {
    // e.g. a delta pass with zero changed bytes
    expect(scaleWarmProgress(80, 95, 0, 0)).toBe(95)
  })

  it("rounds to a whole percent (the job column is an Int)", () => {
    expect(scaleWarmProgress(0, 10, 1, 3)).toBe(3)
  })
})

describe("checksumDiskWindows", () => {
  // Checksum fallback slices of the locked 10→80 full_copy window: per disk,
  // the first 30% of the slice is the scan, the remaining 70% the apply.
  it("gives a single disk the whole 10→80 window, scan ending at 31", () => {
    expect(checksumDiskWindows(0, 1)).toEqual({ scanStart: 10, scanEnd: 31, applyEnd: 80 })
  })

  it("splits multiple disks into equal contiguous slices", () => {
    expect(checksumDiskWindows(0, 2)).toEqual({ scanStart: 10, scanEnd: 20.5, applyEnd: 45 })
    expect(checksumDiskWindows(1, 2)).toEqual({ scanStart: 45, scanEnd: 55.5, applyEnd: 80 })
  })

  it("keeps windows contiguous and monotonic: one disk's applyEnd is the next disk's scanStart", () => {
    for (const count of [1, 2, 3, 5]) {
      for (let i = 0; i < count; i++) {
        const w = checksumDiskWindows(i, count)
        expect(w.scanStart).toBeLessThan(w.scanEnd)
        expect(w.scanEnd).toBeLessThan(w.applyEnd)
        if (i > 0) expect(w.scanStart).toBeCloseTo(checksumDiskWindows(i - 1, count).applyEnd, 10)
      }
      expect(checksumDiskWindows(count - 1, count).applyEnd).toBeCloseTo(80, 10)
    }
  })
})

describe("markVolumesCopied", () => {
  it("moves every allocated volume from the free list to the keep list (#612)", () => {
    // Called after a copy pass completed for ALL disks: the target now holds a
    // bootable snapshot-consistent image, so a later failure must not delete it.
    const volumes: AllocatedVolume[] = [
      { volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "/dev/a" },
      { volumeId: "FC-HDC-01:vm-250-disk-2", devicePath: "/dev/b", rbdMapped: false },
    ]
    expect(volumesToFree(volumes)).toEqual(volumes)

    markVolumesCopied(volumes)

    expect(volumesToFree(volumes)).toEqual([])
    expect(volumesToKeep(volumes)).toEqual(volumes)
  })

  it("keeps a kept volume out of the keep report once the cutover attach lands", () => {
    // After the attach the volume belongs to the VM config: it is neither freed
    // nor reported as left behind.
    const volumes: AllocatedVolume[] = [{ volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "/dev/a" }]
    markVolumesCopied(volumes)
    for (const v of volumes) v.attached = true

    expect(volumesToFree(volumes)).toEqual([])
    expect(volumesToKeep(volumes)).toEqual([])
  })
})

describe("warm cutover signal", () => {
  it("records and reads a cutover request per job", () => {
    expect(__isCutoverRequestedForTest("job-x")).toBe(false)
    requestWarmCutover("job-x")
    expect(__isCutoverRequestedForTest("job-x")).toBe(true)
    expect(__isCutoverRequestedForTest("job-y")).toBe(false)
  })
})

describe("awaitOperatorCutover", () => {
  // updateJob() runs through the tenant-scoped Prisma client, which verifies
  // the row exists (and belongs to the tenant) before updating it — so the
  // job row must be seeded first, same as runWarmMigration does in production.
  beforeEach(() => truncate(["migration_jobs"]))

  async function seedJob(id: string): Promise<void> {
    await prismaTest.migrationJob.create({
      data: {
        id, tenantId: "default",
        sourceConnectionId: "src", sourceVmId: "vm-1",
        targetConnectionId: "tgt", targetNode: "pve1", targetStorage: "local-lvm",
      },
    })
  }

  it("resolves promptly once cutover is requested", async () => {
    const jobId = "gate-1"
    await seedJob(jobId)
    const p = __awaitOperatorCutoverForTest(jobId, 2505, 300, 5, { pollMs: 5, timeoutMs: 10_000 })
    requestWarmCutover(jobId)
    await expect(p).resolves.toBeUndefined()
  })

  it("throws on the safety timeout", async () => {
    await seedJob("gate-2")
    await expect(
      __awaitOperatorCutoverForTest("gate-2", 2505, 300, 5, { pollMs: 5, timeoutMs: 20 })
    ).rejects.toThrow(/timed out/i)
  })
})
