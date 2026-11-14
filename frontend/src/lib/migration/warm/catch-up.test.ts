import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ log: vi.fn(async (..._args: unknown[]) => {}), cancelled: false }))
vi.mock("./job-control", () => ({ appendLog: h.log, isCancelled: () => h.cancelled }))

import { CATCH_UP_MIN_AGE_MS, catchUpBeforeCutover } from "./catch-up"

const MB = 1048576
const messages = () => h.log.mock.calls.map(c => `${c[2] ?? "info"}: ${c[1]}`)

beforeEach(() => { h.log.mockClear(); h.cancelled = false })

describe("catchUpBeforeCutover", () => {
  it("runs one more sync while the source still runs, and says what it copied", async () => {
    const runPass = vi.fn(async () => 12 * MB)

    await expect(catchUpBeforeCutover("j1", Date.now() - 3_600_000, runPass)).resolves.toBe(12 * MB)

    expect(runPass).toHaveBeenCalledTimes(1)
    expect(messages()[0]).toBe("info: Cutover: one more sync first, while the source VM still runs. Only what changes during this sync is left to copy once the source is stopped.")
    expect(messages()[1]).toMatch(/^info: Catch-up sync: 12\.0 MB in \d+ s\. Stopping the source now\.$/)
  })

  it("skips the sync when the last one just ended", async () => {
    const runPass = vi.fn(async () => 0)

    await expect(catchUpBeforeCutover("j1", Date.now() - (CATCH_UP_MIN_AGE_MS - 1000), runPass)).resolves.toBe(0)

    expect(runPass).not.toHaveBeenCalled()
    expect(h.log).not.toHaveBeenCalled()
  })

  it("catches up when no sync has ended yet in this run", async () => {
    const runPass = vi.fn(async () => 0)
    await catchUpBeforeCutover("j1", undefined, runPass)
    expect(runPass).toHaveBeenCalledTimes(1)
  })

  it("carries on with the cutover when the sync fails: the changes are copied with the source stopped", async () => {
    const runPass = vi.fn(async () => { throw new Error("snapshot timed out") })

    await expect(catchUpBeforeCutover("j1", undefined, runPass)).resolves.toBe(0)

    expect(messages()[1]).toBe("warn: Catch-up sync failed (snapshot timed out). Carrying on with the cutover: the changes since the last sync are copied with the source stopped, which lengthens the downtime.")
  })

  it("lets a cancellation through", async () => {
    const runPass = vi.fn(async () => { h.cancelled = true; throw new Error("Migration cancelled") })
    await expect(catchUpBeforeCutover("j1", undefined, runPass)).rejects.toThrow("Migration cancelled")
  })
})
