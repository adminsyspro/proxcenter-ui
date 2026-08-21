import { describe, it, expect, vi, beforeEach } from "vitest"

const waitForPveTaskMock = vi.fn<(...args: any[]) => Promise<any>>()

// Spread the real module: the follower has its own suite, and a factory listing
// only what we import today breaks the day another export is used.
vi.mock("./waitForTaskClient", async io => {
  const actual = await io<typeof import("./waitForTaskClient")>()

  return { ...actual, waitForPveTask: waitForPveTaskMock }
})

const { putGuestConfig } = await import("./guestConfigClient")

const UPID = "UPID:pve3:0000ABCD:00112233:66C0FFEE:qmconfig:100:root@pam:"

function response(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** What the route answers when PVE is still applying the change. */
const pendingBody = { data: UPID, success: true, pending: true, upid: UPID, node: "pve3" }

beforeEach(() => {
  waitForPveTaskMock.mockReset().mockResolvedValue({ outcome: "ok" })
  vi.restoreAllMocks()
})

describe("putGuestConfig", () => {
  it("writes the patch to the guest config route", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(response(200, { success: true }))

    await putGuestConfig("conn 1", "qemu", "pve 3", "100", { memory: 4096 })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]

    // Every segment is encoded: a connection id or a node name may carry a space.
    expect(url).toBe("/api/v1/connections/conn%201/guests/qemu/pve%203/100/config")
    expect(init.method).toBe("PUT")
    expect(init.body).toBe(JSON.stringify({ memory: 4096 }))
  })

  it("returns without following anything when PVE was already done", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(response(200, { success: true }))

    await putGuestConfig("conn-1", "qemu", "pve3", "100", { memory: 4096 })

    expect(waitForPveTaskMock).not.toHaveBeenCalled()
  })

  it("surfaces the route's error message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(response(403, { error: "This node is not authorized for your vDC" }))

    await expect(putGuestConfig("conn-1", "qemu", "pve3", "100", { memory: 4096 }))
      .rejects.toThrow("This node is not authorized for your vDC")
  })

  it("falls back to the HTTP status when the body carries no reason", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new Error("not json") },
    } as unknown as Response)

    await expect(putGuestConfig("conn-1", "qemu", "pve3", "100", { memory: 4096 }))
      .rejects.toThrow("HTTP 502")
  })

  it("follows the task of a 202 and reports the pending state once (#743)", async () => {
    // The change IS being applied. Reporting an error here was the bug.
    vi.spyOn(global, "fetch").mockResolvedValue(response(202, pendingBody))
    const onPending = vi.fn()

    await putGuestConfig("conn-1", "qemu", "pve3", "100", { memory: 4096 }, { onPending })

    expect(onPending).toHaveBeenCalledTimes(1)
    expect(waitForPveTaskMock).toHaveBeenCalledWith("conn-1", "pve3", UPID)
  })

  it("throws the task's own error when it failed", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(response(202, pendingBody))
    waitForPveTaskMock.mockResolvedValue({ outcome: "failed", error: "error unplug memory module" })

    await expect(putGuestConfig("conn-1", "qemu", "pve3", "100", { memory: 4096 }))
      .rejects.toThrow("error unplug memory module")
  })

  it("falls back to the caller's message when the task failed without a reason", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(response(202, pendingBody))
    waitForPveTaskMock.mockResolvedValue({ outcome: "failed", error: "" })

    await expect(
      putGuestConfig("conn-1", "qemu", "pve3", "100", { memory: 4096 }, { failedMessage: "Traduit" }),
    ).rejects.toThrow("Traduit")
  })

  it("reports a task we stopped following", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(response(202, pendingBody))
    waitForPveTaskMock.mockResolvedValue({ outcome: "timeout" })

    await expect(
      putGuestConfig("conn-1", "qemu", "pve3", "100", { memory: 4096 }, { timeoutMessage: "Toujours en cours" }),
    ).rejects.toThrow("Toujours en cours")
  })

  it("has a message of its own for both task outcomes", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(response(202, pendingBody))

    waitForPveTaskMock.mockResolvedValue({ outcome: "failed", error: "" })
    await expect(putGuestConfig("conn-1", "qemu", "pve3", "100", {})).rejects.toThrow(/could not apply/i)

    waitForPveTaskMock.mockResolvedValue({ outcome: "timeout" })
    await expect(putGuestConfig("conn-1", "qemu", "pve3", "100", {})).rejects.toThrow(/still applying/i)
  })

  it("ignores a pending answer that carries no task to follow", async () => {
    // Defensive: an old route, or a truncated body, must not hang the save.
    vi.spyOn(global, "fetch").mockResolvedValue(response(202, { success: true, pending: true }))

    await putGuestConfig("conn-1", "qemu", "pve3", "100", { memory: 4096 })

    expect(waitForPveTaskMock).not.toHaveBeenCalled()
  })

  it("stays quiet when the task ends well", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(response(202, pendingBody))
    waitForPveTaskMock.mockResolvedValue({ outcome: "ok" })

    await expect(putGuestConfig("conn-1", "qemu", "pve3", "100", { memory: 4096 })).resolves.toBeUndefined()
  })
})
