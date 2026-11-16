import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildStopCopyCmd, watchCancel } from "./cancel-watch"

describe("buildStopCopyCmd", () => {
  // The patterns start with a one-character class so pkill never matches the
  // shell that runs them; dd is matched on its device, the scan loop on its marker.
  it("stops the dd reading a device and the checksum loop scanning it", () => {
    expect(buildStopCopyCmd(["/dev/nbd3"])).toBe("pkill -f '[s]can=.?/dev/nbd3([^0-9]|$)' 2>/dev/null; pkill -f '[d]d if=/dev/nbd3 ' 2>/dev/null; true")
  })

  it("leaves out a device path that is not a plain path", () => {
    expect(buildStopCopyCmd(["/dev/nbd1", "/dev/x;reboot", "/dev/r177/vm-120-disk-1"])).toBe(
      "pkill -f '[s]can=.?/dev/nbd1([^0-9]|$)' 2>/dev/null; pkill -f '[d]d if=/dev/nbd1 ' 2>/dev/null; " +
      "pkill -f '[s]can=.?/dev/r177/vm-120-disk-1([^0-9]|$)' 2>/dev/null; pkill -f '[d]d if=/dev/r177/vm-120-disk-1 ' 2>/dev/null; true",
    )
  })
})

describe("watchCancel", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("stops the command once when the migration is cancelled", async () => {
    let cancelled = false
    const stop = vi.fn(async () => {})
    const w = watchCancel({ cancelled: () => cancelled, stop })
    await vi.advanceTimersByTimeAsync(4000)
    expect(stop).not.toHaveBeenCalled()
    cancelled = true
    await vi.advanceTimersByTimeAsync(6000)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(w.fired()).toBe(true)
    w.done()
  })

  it("stops watching once done", async () => {
    let cancelled = false
    const stop = vi.fn(async () => {})
    const w = watchCancel({ cancelled: () => cancelled, stop })
    w.done()
    cancelled = true
    await vi.advanceTimersByTimeAsync(10_000)
    expect(stop).not.toHaveBeenCalled()
    expect(w.fired()).toBe(false)
  })
})
