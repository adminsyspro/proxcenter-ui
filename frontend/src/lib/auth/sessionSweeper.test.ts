import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { startSessionSweeper, SESSION_SWEEP_INTERVAL_MS } from "./sessionSweeper"

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("startSessionSweeper", () => {
  it("runs the purge once per interval (N advances -> N purges)", async () => {
    const purge = vi.fn().mockResolvedValue(0)
    const stop = startSessionSweeper({ intervalMs: 1000, purge })
    await vi.advanceTimersByTimeAsync(3000)
    expect(purge).toHaveBeenCalledTimes(3)
    stop()
  })

  it("defaults to an hourly interval", async () => {
    const purge = vi.fn().mockResolvedValue(0)
    const stop = startSessionSweeper({ purge })
    await vi.advanceTimersByTimeAsync(SESSION_SWEEP_INTERVAL_MS - 1)
    expect(purge).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(purge).toHaveBeenCalledTimes(1)
    stop()
  })

  it("a rejected purge does not throw and does not stop the sweeper", async () => {
    const purge = vi.fn().mockRejectedValue(new Error("db down"))
    const stop = startSessionSweeper({ intervalMs: 1000, purge })
    await vi.advanceTimersByTimeAsync(3000)
    expect(purge).toHaveBeenCalledTimes(3)
    stop()
  })

  it("skips a tick while the previous purge is still in-flight (no overlap)", async () => {
    let resolvePurge: (n: number) => void
    const pending = new Promise<number>(r => { resolvePurge = r })
    const purge = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(0)
    const stop = startSessionSweeper({ intervalMs: 1000, purge })

    await vi.advanceTimersByTimeAsync(3000)
    expect(purge).toHaveBeenCalledTimes(1)

    resolvePurge!(0)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(purge).toHaveBeenCalledTimes(2)
    stop()
  })

  it("stop() halts further purges; calling stop() twice is safe", async () => {
    const purge = vi.fn().mockResolvedValue(0)
    const stop = startSessionSweeper({ intervalMs: 1000, purge })
    await vi.advanceTimersByTimeAsync(2000)
    expect(purge).toHaveBeenCalledTimes(2)
    stop()
    stop() // second call must not throw
    await vi.advanceTimersByTimeAsync(5000)
    expect(purge).toHaveBeenCalledTimes(2) // no additional purges
  })

  it("unrefs the interval timer so it cannot keep the process alive", () => {
    vi.useRealTimers()
    const unref = vi.fn()
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as any)
    try {
      const purge = vi.fn().mockResolvedValue(0)
      const stop = startSessionSweeper({ intervalMs: 1000, purge })
      expect(unref).toHaveBeenCalledTimes(1)
      stop()
    } finally {
      setIntervalSpy.mockRestore()
    }
  })

  it("logs only when the purge actually deleted rows", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      const purge = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(3)
      const stop = startSessionSweeper({ intervalMs: 1000, purge })
      await vi.advanceTimersByTimeAsync(1000)
      expect(logSpy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(logSpy).toHaveBeenCalledTimes(1)
      expect(logSpy.mock.calls[0][0]).toMatch(/^\[session-sweeper\]/)
      stop()
    } finally {
      logSpy.mockRestore()
    }
  })
})
