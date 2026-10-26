import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>()
  return { ...actual, request: requestMock }
})

const { Agent } = await import("undici")
const { pbsFetch, getPbsAgent, PBS_DEFAULT_TIMEOUT_MS, PBS_SLOW_READ_TIMEOUT_MS } = await import("./pbs-client")

// undici keeps the constructor options behind a private symbol; that is the
// only way to read `allowH2` back from an Agent instance.
function agentOptions(agent: object): Record<string, any> {
  const key = Object.getOwnPropertySymbols(agent).find((s) => s.description === "options")!
  return (agent as any)[key]
}

const ok = (data: unknown) => ({
  statusCode: 200,
  body: { text: async () => JSON.stringify({ data }) },
})

/** A PBS that accepted the request and never answers: only the signal ends it. */
const neverAnswers = (_url: string, init: { signal: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason))
  })

const conn = { baseUrl: "https://pbs.example:8007/", apiToken: "backup@pbs!ui:secret" }

describe("pbsFetch transport", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it("reuses one insecure Agent pinned to HTTP/1.1 when insecureDev is set", async () => {
    requestMock.mockResolvedValue(ok([{ store: "main" }]))

    const first = await pbsFetch({ ...conn, insecureDev: true }, "/admin/datastore")
    await pbsFetch({ ...conn, insecureDev: true }, "/admin/datastore")

    expect(first).toEqual([{ store: "main" }])
    const [url, init] = requestMock.mock.calls[0]
    expect(url).toBe("https://pbs.example:8007/api2/json/admin/datastore")
    expect(init.method).toBe("GET")
    expect(init.headers.Authorization).toBe("PBSAPIToken=backup@pbs!ui:secret")
    expect(init.dispatcher).toBeInstanceOf(Agent)
    expect(agentOptions(init.dispatcher).allowH2).toBe(false)
    expect(agentOptions(init.dispatcher).connect.rejectUnauthorized).toBe(false)
    expect(requestMock.mock.calls[1][1].dispatcher).toBe(init.dispatcher)
  })

  it("uses its own verifying Agent otherwise, never the process-wide dispatcher", async () => {
    requestMock.mockResolvedValue(ok({ version: "4.0" }))

    const out = await pbsFetch(conn, "/version")

    expect(out).toEqual({ version: "4.0" })
    const dispatcher = requestMock.mock.calls[0][1].dispatcher
    expect(dispatcher).toBe(getPbsAgent(false))
    expect(dispatcher).not.toBe(getPbsAgent(true))
    expect(agentOptions(dispatcher).allowH2).toBe(false)
    expect(agentOptions(dispatcher).connect.rejectUnauthorized).toBeUndefined()
  })

  it("bounds the TCP and TLS handshake on both agents", () => {
    for (const insecure of [false, true]) {
      expect(agentOptions(getPbsAgent(insecure)).connect.timeout).toBe(5_000)
    }
  })

  it("serialises object bodies as JSON and reports non-2xx answers", async () => {
    requestMock.mockResolvedValue({ statusCode: 400, body: { text: async () => "bad token" } })

    await expect(
      pbsFetch(conn, "/access/ticket", { method: "POST", body: { username: "x" } as any })
    ).rejects.toThrow("PBS 400 /access/ticket: bad token")
    const init = requestMock.mock.calls[0][1]
    expect(init.method).toBe("POST")
    expect(init.body).toBe(JSON.stringify({ username: "x" }))
    expect(init.headers["Content-Type"]).toBe("application/json")
  })
})

describe("pbsFetch budgets", () => {
  let timeoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    requestMock.mockReset()
    timeoutSpy = vi.spyOn(AbortSignal, "timeout")
  })

  afterEach(() => {
    timeoutSpy.mockRestore()
  })

  it("applies the default budget to every request", async () => {
    requestMock.mockResolvedValue(ok([]))

    await pbsFetch(conn, "/admin/datastore")

    expect(PBS_DEFAULT_TIMEOUT_MS).toBe(15_000)
    expect(timeoutSpy).toHaveBeenCalledWith(PBS_DEFAULT_TIMEOUT_MS)
    expect(requestMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it("gives slow reads the long budget, still under the 60s proxy timeout", async () => {
    requestMock.mockResolvedValue(ok([]))

    await pbsFetch(conn, "/admin/datastore/main/snapshots", {}, { slowRead: true })

    expect(PBS_SLOW_READ_TIMEOUT_MS).toBe(45_000)
    expect(timeoutSpy).toHaveBeenCalledWith(PBS_SLOW_READ_TIMEOUT_MS)
  })

  it("names the budget when a PBS accepts the request and never answers", async () => {
    requestMock.mockImplementation(neverAnswers)

    await expect(pbsFetch(conn, "/admin/datastore", {}, { timeoutMs: 20 }))
      .rejects.toThrow("PBS timeout after 20ms /admin/datastore")
  })

  it("lets a caller signal shorten the request and reports it as the caller's abort", async () => {
    requestMock.mockImplementation(neverAnswers)
    const caller = new AbortController()

    const pending = pbsFetch(conn, "/admin/datastore", { signal: caller.signal })
    caller.abort(new Error("client went away"))

    await expect(pending).rejects.toThrow("client went away")
  })

  it("keeps the budget when the caller's signal is longer", async () => {
    requestMock.mockImplementation(neverAnswers)

    await expect(
      pbsFetch(conn, "/admin/datastore", { signal: AbortSignal.timeout(60_000) }, { timeoutMs: 20 })
    ).rejects.toThrow("PBS timeout after 20ms")
  })
})
