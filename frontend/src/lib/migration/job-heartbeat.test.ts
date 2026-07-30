import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { startJobHeartbeat, JOB_HEARTBEAT_INTERVAL_MS } from "./job-heartbeat"

function makePrisma(updateMany = vi.fn().mockResolvedValue({ count: 1 })) {
  return { prisma: { migrationJob: { updateMany } } as any, updateMany }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("startJobHeartbeat", () => {
  it("touches the job row once per interval (N advances → N writes)", async () => {
    const { prisma, updateMany } = makePrisma()
    const stop = startJobHeartbeat({ jobId: "job-1", prisma, intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(updateMany).toHaveBeenCalledTimes(3)
    stop()
  })

  it("defaults to a 60 s interval", async () => {
    const { prisma, updateMany } = makePrisma()
    const stop = startJobHeartbeat({ jobId: "job-1", prisma })
    await vi.advanceTimersByTimeAsync(JOB_HEARTBEAT_INTERVAL_MS - 1)
    expect(updateMany).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(updateMany).toHaveBeenCalledTimes(1)
    stop()
  })

  it("scopes the write to the job AND a non-terminal status, and only bumps updatedAt", async () => {
    const { prisma, updateMany } = makePrisma()
    const stop = startJobHeartbeat({ jobId: "job-1", prisma, intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: { notIn: ["completed", "failed", "cancelled"] } },
      data: { updatedAt: expect.any(Date) },
    })
    // The touch must never carry status/progress/logs — those belong to the pipeline.
    expect(Object.keys(updateMany.mock.calls[0][0].data)).toEqual(["updatedAt"])
    stop()
  })

  it("stop() halts further writes; calling stop() twice is safe", async () => {
    const { prisma, updateMany } = makePrisma()
    const stop = startJobHeartbeat({ jobId: "job-1", prisma, intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(updateMany).toHaveBeenCalledTimes(2)
    stop()
    stop() // second call must not throw
    await vi.advanceTimersByTimeAsync(5000)
    expect(updateMany).toHaveBeenCalledTimes(2) // no additional writes
  })

  it("a rejected write does not throw and does not stop the heartbeat", async () => {
    const { prisma, updateMany } = makePrisma(vi.fn().mockRejectedValue(new Error("db down")))
    const onError = vi.fn()
    const stop = startJobHeartbeat({ jobId: "job-1", prisma, intervalMs: 1000, onError })
    await vi.advanceTimersByTimeAsync(3000)
    expect(updateMany).toHaveBeenCalledTimes(3)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "db down" }))
    stop()
  })

  it("a throwing onError hook is swallowed too", async () => {
    const { prisma, updateMany } = makePrisma(vi.fn().mockRejectedValue(new Error("db down")))
    const stop = startJobHeartbeat({
      jobId: "job-1", prisma, intervalMs: 1000,
      onError: () => { throw new Error("bad hook") },
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(updateMany).toHaveBeenCalledTimes(2)
    stop()
  })

  it("skips a tick while the previous write is still in-flight (no pile-up on a stalled DB)", async () => {
    let resolveWrite: (v: { count: number }) => void
    const pending = new Promise<{ count: number }>(r => { resolveWrite = r })
    const { prisma, updateMany } = makePrisma(vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ count: 1 }))
    const stop = startJobHeartbeat({ jobId: "job-1", prisma, intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(3000)
    expect(updateMany).toHaveBeenCalledTimes(1)

    resolveWrite!({ count: 1 })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(updateMany).toHaveBeenCalledTimes(2)
    stop()
  })

  it("unrefs the interval timer so it cannot keep the process alive", () => {
    vi.useRealTimers()
    const unref = vi.fn()
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as any)
    try {
      const { prisma } = makePrisma()
      const stop = startJobHeartbeat({ jobId: "job-1", prisma, intervalMs: 1000 })
      expect(unref).toHaveBeenCalledTimes(1)
      stop()
    } finally {
      setIntervalSpy.mockRestore()
    }
  })
})
