import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>()
  return { ...actual, request: requestMock }
})
vi.mock("../connections/getConnection", () => ({ invalidateConnectionCache: vi.fn() }))
vi.mock("../license/exclusions", async importOriginal => ({ ...(await importOriginal<typeof import("../license/exclusions")>()), isConnectionLicenseExcluded: async () => false }))

const { pveFetch, isTransientDnsError, PveApplicationError } = await import("./client")

const ok = (data: unknown) => ({ statusCode: 200, body: { text: async () => JSON.stringify({ data }) } })

/** The error undici raises when getaddrinfo answers "try again" (shape captured in a netns without DNS). */
function eaiAgain(host = "fr6-pve-lb.example.com") {
  return Object.assign(new Error(`getaddrinfo EAI_AGAIN ${host}`), { code: "EAI_AGAIN", errno: -3001, syscall: "getaddrinfo", hostname: host })
}

const conn = { baseUrl: "https://fr6-pve-lb.example.com:8006", apiToken: "u@pam!t=s", behindProxy: true }

beforeEach(() => {
  requestMock.mockReset()
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("isTransientDnsError (discussion #1363)", () => {
  it("matches EAI_AGAIN on the error or on its cause", () => {
    expect(isTransientDnsError(eaiAgain())).toBe(true)
    expect(isTransientDnsError(Object.assign(new Error("fetch failed"), { cause: eaiAgain() }))).toBe(true)
  })

  it("does not match a PVE answer that quotes EAI_AGAIN, nor other failures", () => {
    expect(isTransientDnsError(new PveApplicationError("PVE 500 /storage: getaddrinfo EAI_AGAIN nfs01", 500))).toBe(false)
    expect(isTransientDnsError(Object.assign(new Error("getaddrinfo ENOTFOUND x"), { code: "ENOTFOUND" }))).toBe(false)
    expect(isTransientDnsError(new Error("EAI_AGAIN in a message only"))).toBe(false)
    expect(isTransientDnsError("EAI_AGAIN")).toBe(false)
  })
})

describe("pveFetch on a temporary DNS failure (discussion #1363)", () => {
  it("retries a write that never left, and sends it once it resolves", async () => {
    requestMock.mockRejectedValueOnce(eaiAgain()).mockResolvedValueOnce(ok("UPID:start"))
    const p = pveFetch<any>(conn, "/nodes/n2/qemu/147/status/start", { method: "POST" })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(p).resolves.toBe("UPID:start")
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(requestMock.mock.calls.every(c => c[1].method === "POST")).toBe(true)
  })

  it("gives up after two retries and throws the DNS error unchanged", async () => {
    requestMock.mockRejectedValue(eaiAgain())
    const p = pveFetch<any>(conn, "/cluster/resources")
    const settled = p.catch((e: any) => e)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(3_000)
    const err = await settled
    expect(err.message).toBe("getaddrinfo EAI_AGAIN fr6-pve-lb.example.com")
    expect(requestMock).toHaveBeenCalledTimes(3)
  })

  it("gives each attempt its own time budget", async () => {
    requestMock.mockRejectedValueOnce(eaiAgain()).mockRejectedValueOnce(eaiAgain()).mockResolvedValueOnce(ok(1))
    const p = pveFetch<any>(conn, "/version", {}, { timeoutMs: 2_000 })
    await vi.advanceTimersByTimeAsync(4_000)
    await expect(p).resolves.toBe(1)
    expect(requestMock.mock.calls.map(c => c[1].signal.aborted)).toEqual([false, false, false])
  })

  it("does not retry once the caller has gone", async () => {
    const ac = new AbortController()
    requestMock.mockRejectedValue(eaiAgain())
    const p = pveFetch<any>(conn, "/version", { signal: ac.signal })
    const settled = p.catch((e: any) => e)
    await vi.advanceTimersByTimeAsync(0)
    ac.abort()
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await settled).name).toBe("AbortError")
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("does not wait to retry when the caller left during the failed lookup", async () => {
    const ac = new AbortController()
    requestMock.mockImplementation(async () => { ac.abort(); throw eaiAgain() })
    const settled = pveFetch<any>(conn, "/version", { signal: ac.signal }).catch((e: any) => e)
    expect((await settled).name).toBe("AbortError")
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("does not retry an answer PVE gave, whatever it says", async () => {
    requestMock.mockResolvedValue({ statusCode: 500, body: { text: async () => "getaddrinfo EAI_AGAIN nfs01" } })
    await expect(pveFetch<any>(conn, "/nodes/n2/storage")).rejects.toBeInstanceOf(PveApplicationError)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("does not retry other network failures in place", async () => {
    requestMock.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))
    await expect(pveFetch<any>(conn, "/version")).rejects.toThrow("ECONNREFUSED")
    expect(requestMock).toHaveBeenCalledTimes(1)
  })
})
