import { describe, it, expect, vi, beforeEach } from "vitest"

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

// Real module minus pveFetch: PVE_DEFAULT_TIMEOUT_MS has to keep reading the
// environment, and a factory listing only pveFetch would break the day this
// module imports anything else from the client.
vi.mock("./client", async io => {
  const actual = await io<typeof import("./client")>()

  return { ...actual, pveFetch: pveFetchMock }
})

const { writeGuestConfig, parseUpid, backgroundDelaySeconds, CONFIG_TASK_WAIT_MS } = await import("./guestConfigWrite")

const conn = { baseUrl: "https://pve1:8006", apiToken: "root@pam!t=s", id: "conn-1" } as any
const UPID = "UPID:pve3:0000ABCD:00112233:66C0FFEE:qmconfig:100:root@pam:"

/** The config write is always the first call; the rest are task polls. */
function writeCall() {
  return pveFetchMock.mock.calls[0]
}

beforeEach(() => {
  pveFetchMock.mockReset()
})

describe("parseUpid", () => {
  it("pulls the node out of a UPID", () => {
    expect(parseUpid(UPID)).toEqual({ upid: UPID, node: "pve3" })
  })

  it("rejects anything that is not a task id", () => {
    // The synchronous LXC handler answers null, and a qemu write with nothing
    // to apply answers an empty body.
    expect(parseUpid(null)).toBeNull()
    expect(parseUpid(undefined)).toBeNull()
    expect(parseUpid("")).toBeNull()
    expect(parseUpid(42)).toBeNull()
    expect(parseUpid({ upid: UPID })).toBeNull()
    expect(parseUpid("not-a-upid")).toBeNull()
  })
})

describe("writeGuestConfig", () => {
  it("uses PVE's asynchronous handler for a qemu guest (#743)", async () => {
    // POST is update_vm_async, which forks a qmconfig worker instead of
    // holding the request open for the whole hotplug. PVE's own PUT
    // description tells API clients to prefer it for hotplug.
    pveFetchMock.mockResolvedValueOnce(null)

    await writeGuestConfig({ conn, type: "qemu", node: "pve3", vmid: "100", body: "memory=4096" })

    expect(writeCall()[1]).toBe("/nodes/pve3/qemu/100/config")
    expect(writeCall()[2]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    })

    // PVE waits for its own worker for that long and answers null when it
    // finished, so a fast write costs one round trip and no polling at all.
    expect(writeCall()[2].body).toBe("memory=4096&background_delay=3")
  })

  it("keeps the synchronous call for an LXC guest, which has no async handler", async () => {
    // PVE::API2::LXC::Config registers PUT only, and an LXC memory change is
    // a cgroup write, so there is nothing slow to move off the request.
    pveFetchMock.mockResolvedValueOnce(null)

    await writeGuestConfig({ conn, type: "lxc", node: "pve3", vmid: "200", body: "memory=2048" })

    expect(writeCall()[1]).toBe("/nodes/pve3/lxc/200/config")
    expect(writeCall()[2]).toMatchObject({ method: "PUT" })

    // The synchronous schema refuses anything it does not declare, and
    // background_delay is declared on the asynchronous one only.
    expect(writeCall()[2].body).toBe("memory=2048")
  })

  it("reports done without polling when PVE returned no task", async () => {
    pveFetchMock.mockResolvedValueOnce(null)

    const result = await writeGuestConfig({ conn, type: "lxc", node: "pve3", vmid: "200", body: "memory=2048" })

    expect(result).toEqual({ state: "done", upid: null })
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it("waits for the task and reports done when it ends on OK", async () => {
    pveFetchMock
      .mockResolvedValueOnce(UPID)
      .mockResolvedValueOnce({ status: "stopped", exitstatus: "OK" })

    const result = await writeGuestConfig({
      conn, type: "qemu", node: "pve3", vmid: "100", body: "memory=4096", waitMs: 5_000,
    })

    expect(result).toEqual({ state: "done", upid: UPID })
    expect(pveFetchMock.mock.calls[1][1]).toBe(`/nodes/pve3/tasks/${encodeURIComponent(UPID)}/status`)
  })

  it("polls the node named by the UPID, not the one we wrote to", async () => {
    // PVE proxies the write, so the worker can run somewhere else entirely.
    const remoteUpid = "UPID:pve2:0000ABCD:00112233:66C0FFEE:qmconfig:100:root@pam:"

    pveFetchMock
      .mockResolvedValueOnce(remoteUpid)
      .mockResolvedValueOnce({ status: "stopped", exitstatus: "OK" })

    await writeGuestConfig({
      conn, type: "qemu", node: "pve3", vmid: "100", body: "memory=4096", waitMs: 5_000,
    })

    expect(pveFetchMock.mock.calls[1][1]).toContain("/nodes/pve2/tasks/")
  })

  it("throws PVE's own exitstatus when the task fails", async () => {
    // A memory unplug that never releases its DIMM ends here, and the caller
    // needs it to undo its own side effects.
    pveFetchMock
      .mockResolvedValueOnce(UPID)
      .mockResolvedValueOnce({ status: "stopped", exitstatus: "error unplug memory module" })

    await expect(
      writeGuestConfig({ conn, type: "qemu", node: "pve3", vmid: "100", body: "memory=4096", waitMs: 5_000 }),
    ).rejects.toThrow("error unplug memory module")
  })

  it("reports the task as running once the budget is spent, without failing the write", async () => {
    // The change IS being applied. Answering an error here is exactly the bug
    // of issue #743, so the caller gets the UPID to keep following instead.
    pveFetchMock
      .mockResolvedValueOnce(UPID)
      .mockResolvedValueOnce({ status: "running" })

    const result = await writeGuestConfig({
      conn, type: "qemu", node: "pve3", vmid: "100", body: "memory=4096", waitMs: 0,
    })

    expect(result).toEqual({ state: "running", upid: UPID, node: "pve3" })
    expect(pveFetchMock).toHaveBeenCalledTimes(2)
  })

  it("retries a status poll that blew up instead of reporting a failed save", async () => {
    // A blip on the task endpoint says nothing about the write, which PVE has
    // already accepted.
    pveFetchMock
      .mockResolvedValueOnce(UPID)
      .mockRejectedValueOnce(new Error("PVE 596 tasks: connection error"))
      .mockResolvedValueOnce({ status: "stopped", exitstatus: "OK" })

    const result = await writeGuestConfig({
      conn, type: "qemu", node: "pve3", vmid: "100", body: "memory=4096", waitMs: 5_000,
    })

    expect(result).toEqual({ state: "done", upid: UPID })
    expect(pveFetchMock).toHaveBeenCalledTimes(3)
  })

  it("stays under the reverse proxy's 60s read timeout by default", () => {
    // nginx/proxcenter-locations.conf cuts a silent upstream at 60s, and a
    // 504 there would hide our JSON from the browser.
    expect(CONFIG_TASK_WAIT_MS).toBeLessThan(60_000)
  })
})

describe("backgroundDelaySeconds", () => {
  /**
   * PVE holds the HTTP answer for the whole background_delay, so it must stay
   * inside the budget pveFetch gives the request. A deployment running with
   * PVE_TIMEOUT_MS=1000 would otherwise time out on every config write, which
   * is the very bug this module exists to remove.
   */
  it("asks for the full delay on the default budget", () => {
    expect(backgroundDelaySeconds(8_000)).toBe(3)
  })

  it("shortens the delay to stay inside a tight budget", () => {
    expect(backgroundDelaySeconds(2_500)).toBe(1)
  })

  it.each([1_000, 500, 0])("drops the delay entirely on a %sms budget", budgetMs => {
    // PVE's schema has a minimum of 1, and it hands the UPID back right away
    // when we do not ask, which we then follow.
    expect(backgroundDelaySeconds(budgetMs)).toBe(0)
  })

  it("never asks for more than PVE's own 30s maximum", () => {
    expect(backgroundDelaySeconds(600_000)).toBeLessThanOrEqual(30)
  })
})
