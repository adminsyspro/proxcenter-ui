import { describe, it, expect, vi, beforeEach } from "vitest"

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>()
  return { ...actual, request: requestMock }
})

const { Agent } = await import("undici")
const { pbsFetch } = await import("./pbs-client")

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

const conn = { baseUrl: "https://pbs.example:8007/", apiToken: "backup@pbs!ui:secret" }

describe("pbsFetch transport", () => {
  beforeEach(() => requestMock.mockReset())

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

  it("leaves the dispatcher to the process-wide default otherwise", async () => {
    requestMock.mockResolvedValue(ok({ version: "4.0" }))

    const out = await pbsFetch(conn, "/version")

    expect(out).toEqual({ version: "4.0" })
    expect(requestMock.mock.calls[0][1].dispatcher).toBeUndefined()
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
