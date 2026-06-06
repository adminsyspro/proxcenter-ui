import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { startSoapKeepAlive } from "./session-keepalive"

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("startSoapKeepAlive", () => {
  it("fires ping once per interval (N advances → N calls)", async () => {
    const ping = vi.fn().mockResolvedValue(undefined)
    startSoapKeepAlive(ping, 1000)
    await vi.advanceTimersByTimeAsync(3000)
    expect(ping).toHaveBeenCalledTimes(3)
  })

  it("stop() halts further pings; calling stop() twice is safe", async () => {
    const ping = vi.fn().mockResolvedValue(undefined)
    const stop = startSoapKeepAlive(ping, 1000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(ping).toHaveBeenCalledTimes(2)
    stop()
    stop() // second call must not throw
    await vi.advanceTimersByTimeAsync(3000)
    expect(ping).toHaveBeenCalledTimes(2) // no additional calls
  })

  it("a ping that rejects does not stop the ticker (subsequent intervals still fire)", async () => {
    const ping = vi.fn().mockRejectedValue(new Error("transient"))
    const stop = startSoapKeepAlive(ping, 1000)
    await vi.advanceTimersByTimeAsync(3000)
    expect(ping).toHaveBeenCalledTimes(3)
    stop()
  })

  it("re-entrancy guard: skips a tick while the previous ping is still in-flight", async () => {
    let resolvePing: () => void
    const pending = new Promise<void>(r => { resolvePing = r })
    const ping = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined)
    startSoapKeepAlive(ping, 1000)

    // Advance 3 intervals: first call is in-flight (never resolved), ticks 2 and 3 must be skipped.
    await vi.advanceTimersByTimeAsync(3000)
    expect(ping).toHaveBeenCalledTimes(1)

    // Now resolve the in-flight ping.
    resolvePing!()
    await vi.advanceTimersByTimeAsync(0)

    // Next tick after resolution should fire normally.
    await vi.advanceTimersByTimeAsync(1000)
    expect(ping).toHaveBeenCalledTimes(2)
  })
})
