import { describe, it, expect, vi, afterEach } from "vitest"
import { Agent } from "undici"

import { WinRMClient } from "./winrm"

function agentOptions(agent: object): Record<string, any> {
  const key = Object.getOwnPropertySymbols(agent).find((s) => s.description === "options")!
  return (agent as any)[key]
}

const conn = { host: "hv.example", username: "Administrator", password: "pw" }

describe("WinRMClient HTTP transport", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("posts over HTTPS with an insecure Agent pinned to HTTP/1.1", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<s:Envelope/>", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const text = await (new WinRMClient({ ...conn, useSSL: true }) as any).post("<s:Envelope/>")

    expect(text).toBe("<s:Envelope/>")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://hv.example:5986/wsman")
    expect(init.method).toBe("POST")
    expect(init.headers["Accept-Encoding"]).toBe("identity")
    expect(init.dispatcher).toBeInstanceOf(Agent)
    expect(agentOptions(init.dispatcher).allowH2).toBe(false)
    expect(agentOptions(init.dispatcher).connect.rejectUnauthorized).toBe(false)
    await init.dispatcher.destroy()
  })

  it("posts over plain HTTP without a dispatcher and surfaces SOAP faults", async () => {
    const fault = "<s:Envelope><s:Text>Access is denied.</s:Text></s:Envelope>"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(fault, { status: 401 })))

    const client = new WinRMClient(conn) as any
    await expect(client.post("<s:Envelope/>")).rejects.toThrow("WinRM HTTP 401: Access is denied.")
    const init = (globalThis.fetch as any).mock.calls[0][1]
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe("http://hv.example:5985/wsman")
    expect(init.dispatcher).toBeUndefined()
  })
})
