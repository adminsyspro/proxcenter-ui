import { describe, expect, it, vi } from "vitest"

import { applyExtentsWithProgress, warmFinalTransfer } from "./apply"
import { applyTimeoutMs } from "./copy-rate"

describe("warmFinalTransfer", () => {
  it("leaves the disks' capacity as totalBytes and every pass's bytes as bytesTransferred", () => {
    expect(warmFinalTransfer([3 * 2 ** 30, 2 ** 30], 1.5 * 2 ** 30 + 4096)).toEqual({ totalBytes: BigInt(4 * 2 ** 30), bytesTransferred: BigInt(1.5 * 2 ** 30 + 4096) })
  })

  it("never writes a negative or non-finite figure", () => {
    expect(warmFinalTransfer([], -5)).toEqual({ totalBytes: BigInt(0), bytesTransferred: BigInt(0) })
    expect(warmFinalTransfer([Number.NaN], Number.POSITIVE_INFINITY)).toEqual({ totalBytes: BigInt(0), bytesTransferred: BigInt(0) })
  })
})

vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn(async () => ({ success: true, output: "" })) }
})
const cancelled = vi.hoisted(() => ({ value: false }))
vi.mock("./job-control", () => ({ updateJobLive: vi.fn(async () => {}), appendLog: vi.fn(async () => {}), isCancelled: () => cancelled.value }))

describe("applyExtentsWithProgress", () => {
  // A copy under a low rate cap runs for longer than the former fixed 12 h:
  // each command gets 12 h plus its bytes at the lowest cap (1 MB/s).
  it("gives each apply command a budget that grows with its bytes", async () => {
    const { executeSSH } = await import("@/lib/ssh/exec")
    const GiB = 1024 ** 3
    await applyExtentsWithProgress({
      jobId: "j", connectionId: "c", nodeIp: "10.0.0.1", nbdDev: "/dev/nbd0", dev: "/dev/t",
      extents: [{ offset: 0, length: 100 * GiB }], capacityBytes: 100 * GiB, label: "block apply failed", diskIndex: 0,
      pass: { status: "full_copy", currentStep: "full_copy", rangeStart: 10, rangeEnd: 80, totalBytes: 100 * GiB, doneBytes: 0, lastPct: 10 },
    })
    expect(vi.mocked(executeSSH).mock.calls[0][3]).toBe(applyTimeoutMs(100 * GiB))
  })

  // A cancelled migration used to wait for the end of the running command,
  // minutes on a large disk and hours under a low copy rate cap.
  it("stops the running copy when the migration is cancelled", async () => {
    vi.useFakeTimers()
    try {
      const { executeSSH } = await import("@/lib/ssh/exec")
      let finish: (v: any) => void = () => {}
      vi.mocked(executeSSH).mockReset()
        .mockImplementationOnce(() => new Promise(r => { finish = r }) as any)
        .mockImplementation(async () => ({ success: true, output: "" }) as any)
      cancelled.value = false
      const run = applyExtentsWithProgress({
        jobId: "j", connectionId: "c", nodeIp: "10.0.0.1", nbdDev: "/dev/nbd2", dev: "/dev/t",
        extents: [{ offset: 0, length: 1024 ** 3 }], capacityBytes: 1024 ** 3, label: "block apply failed", diskIndex: 0,
        pass: { status: "full_copy", currentStep: "full_copy", rangeStart: 10, rangeEnd: 80, totalBytes: 1024 ** 3, doneBytes: 0, lastPct: 10 },
      })
      const outcome = run.then(() => null, (e: Error) => e)
      cancelled.value = true
      await vi.advanceTimersByTimeAsync(3000)
      expect(vi.mocked(executeSSH).mock.calls[1][2]).toContain("pkill -f '[d]d if=/dev/nbd2 '")
      finish({ success: false, output: "dd: killed" })
      expect((await outcome)?.message).toBe("Migration cancelled")
    } finally {
      cancelled.value = false
      vi.useRealTimers()
    }
  })

  // A capped copy starts with nbdkit's credit of 2 s of its cap: dd's average
  // over its first seconds read 52 MB/s for a 20 MB/s cap. The first readout
  // waits until the burst weighs little in that average.
  it("reports the first throughput only after the start burst", async () => {
    vi.useFakeTimers()
    try {
      const { executeSSH } = await import("@/lib/ssh/exec")
      const { updateJobLive } = await import("./job-control")
      let emit: (s: string) => void = () => {}
      let finish: (v: any) => void = () => {}
      vi.mocked(updateJobLive).mockClear()
      vi.mocked(executeSSH).mockReset().mockImplementation(((_c: string, _ip: string, _cmd: string, _t: number, o: any) => {
        emit = o.onData
        return new Promise(r => { finish = r })
      }) as any)
      const run = applyExtentsWithProgress({
        jobId: "j", connectionId: "c", nodeIp: "10.0.0.1", nbdDev: "/dev/nbd2", dev: "/dev/t",
        extents: [{ offset: 0, length: 1024 ** 3 }], capacityBytes: 1024 ** 3, label: "block apply failed", diskIndex: 0,
        pass: { status: "full_copy", currentStep: "full_copy", rangeStart: 10, rangeEnd: 80, totalBytes: 1024 ** 3, doneBytes: 0, lastPct: 10 },
      })
      await vi.advanceTimersByTimeAsync(4_000)
      emit("104857600 bytes (105 MB, 100 MiB) copied, 4 s, 26.2 MB/s\r")
      await vi.advanceTimersByTimeAsync(0)
      expect(updateJobLive).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(7_000)
      emit("241172480 bytes (241 MB, 230 MiB) copied, 11 s, 21.9 MB/s\r")
      await vi.advanceTimersByTimeAsync(0)
      expect(updateJobLive).toHaveBeenCalledTimes(1)
      finish({ success: true, output: "" })
      await run
    } finally {
      vi.useRealTimers()
    }
  })

  it("reports at once a dd that says it has run past the start burst", async () => {
    const { executeSSH } = await import("@/lib/ssh/exec")
    const { updateJobLive } = await import("./job-control")
    vi.mocked(updateJobLive).mockClear()
    vi.mocked(executeSSH).mockReset().mockImplementation((async (_c: string, _ip: string, _cmd: string, _t: number, o: any) => {
      o.onData("1073741824 bytes (1.1 GB, 1.0 GiB) copied, 10 s, 107 MB/s\r")
      return { success: true, output: "" }
    }) as any)
    await applyExtentsWithProgress({
      jobId: "j", connectionId: "c", nodeIp: "10.0.0.1", nbdDev: "/dev/nbd2", dev: "/dev/t",
      extents: [{ offset: 0, length: 1024 ** 3 }], capacityBytes: 1024 ** 3, label: "block apply failed", diskIndex: 0,
      pass: { status: "full_copy", currentStep: "full_copy", rangeStart: 10, rangeEnd: 80, totalBytes: 1024 ** 3, doneBytes: 0, lastPct: 10 },
    })
    await new Promise(r => setTimeout(r, 0))
    expect(updateJobLive).toHaveBeenCalledTimes(1)
  })
})
