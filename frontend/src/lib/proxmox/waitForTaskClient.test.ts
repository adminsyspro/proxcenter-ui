import { afterEach, describe, expect, it, vi } from "vitest"

import { waitForPveTask } from "./waitForTaskClient"

afterEach(() => vi.restoreAllMocks())

const UPID = "UPID:pve-01:0001A2B3:04C5D6E7:65F01234:qmdelsnapshot:100:root@pam:"

function taskResponse(status: string, exitstatus: string | null = null) {
  return { ok: true, json: async () => ({ status, exitstatus }) } as unknown as Response
}

// Fast polling so retry paths complete in milliseconds without fake timers.
const FAST = { intervalMs: 1, timeoutMs: 5_000 }

describe("waitForPveTask", () => {
  it("polls while the task is running and resolves ok on exitstatus OK", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(taskResponse("running"))
      .mockResolvedValueOnce(taskResponse("stopped", "OK"))

    const res = await waitForPveTask("conn-1", "pve-01", UPID, FAST)

    expect(res).toEqual({ outcome: "ok" })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("resolves ok with the default options when the task is already stopped", async () => {
    // No options argument: exercises the default interval/timeout branches.
    vi.spyOn(global, "fetch").mockResolvedValue(taskResponse("stopped", "OK"))

    const res = await waitForPveTask("conn-1", "pve-01", UPID)

    expect(res).toEqual({ outcome: "ok" })
  })

  it("reports failed with the exact PVE exitstatus", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      taskResponse("stopped", "VM 100 qmp command 'blockdev-del' failed - Node is in use"),
    )

    const res = await waitForPveTask("conn-1", "pve-01", UPID, FAST)

    expect(res).toEqual({
      outcome: "failed",
      error: "VM 100 qmp command 'blockdev-del' failed - Node is in use",
    })
  })

  it("reports failed with an empty error when PVE gave no exitstatus", async () => {
    // The task route serializes a missing exitstatus as null.
    vi.spyOn(global, "fetch").mockResolvedValue(taskResponse("stopped", null))

    const res = await waitForPveTask("conn-1", "pve-01", UPID, FAST)

    expect(res).toEqual({ outcome: "failed", error: "" })
  })

  it("retries after a thrown network error and still succeeds", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(taskResponse("stopped", "OK"))

    const res = await waitForPveTask("conn-1", "pve-01", UPID, FAST)

    expect(res).toEqual({ outcome: "ok" })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("retries after a non-ok HTTP response and still succeeds", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: "bad gateway" }) } as unknown as Response)
      .mockResolvedValueOnce(taskResponse("stopped", "OK"))

    const res = await waitForPveTask("conn-1", "pve-01", UPID, FAST)

    expect(res).toEqual({ outcome: "ok" })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("retries after an unparsable JSON body and still succeeds", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("bad json") } } as unknown as Response)
      .mockResolvedValueOnce(taskResponse("stopped", "OK"))

    const res = await waitForPveTask("conn-1", "pve-01", UPID, FAST)

    expect(res).toEqual({ outcome: "ok" })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("retries after a null body and still succeeds", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => null } as unknown as Response)
      .mockResolvedValueOnce(taskResponse("stopped", "OK"))

    const res = await waitForPveTask("conn-1", "pve-01", UPID, FAST)

    expect(res).toEqual({ outcome: "ok" })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("gives up with timeout when the task never stops within the budget", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(taskResponse("running"))

    const res = await waitForPveTask("conn-1", "pve-01", UPID, { intervalMs: 1, timeoutMs: 15 })

    expect(res).toEqual({ outcome: "timeout" })
  })

  it("returns abandoned without polling when shouldContinue is false up front", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")

    const res = await waitForPveTask("conn-1", "pve-01", UPID, {
      ...FAST,
      shouldContinue: () => false,
    })

    expect(res).toEqual({ outcome: "abandoned" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns abandoned mid-follow when shouldContinue flips to false", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(taskResponse("running"))
    let polls = 0

    const res = await waitForPveTask("conn-1", "pve-01", UPID, {
      ...FAST,
      shouldContinue: () => polls++ < 1,
    })

    expect(res).toEqual({ outcome: "abandoned" })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("encodes every path segment of the task-status URL", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(taskResponse("stopped", "OK"))

    await waitForPveTask("conn 1", "pve/node#1", UPID, FAST)

    const expected =
      `/api/v1/tasks/${encodeURIComponent("conn 1")}` +
      `/${encodeURIComponent("pve/node#1")}/${encodeURIComponent(UPID)}`
    expect(fetchSpy).toHaveBeenCalledWith(expected, { cache: "no-store" })
    expect(String(fetchSpy.mock.calls[0][0])).toContain("UPID%3A")
  })
})
