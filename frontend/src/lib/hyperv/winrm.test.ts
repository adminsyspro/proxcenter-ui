import { describe, it, expect, vi, afterEach } from "vitest"
import { Agent } from "undici"

import { WinRMClient, cleanPowerShellStderr } from "./winrm"

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

describe("WinRMClient receive loop", () => {
  afterEach(() => vi.unstubAllGlobals())

  const streamDone = (text: string) =>
    `<s:Envelope><rsp:ReceiveResponse><rsp:Stream Name="stdout" CommandId="c1">${Buffer.from(text).toString("base64")}</rsp:Stream>` +
    `<rsp:CommandState CommandId="c1" State="http://schemas.microsoft.com/wbem/wsman/1/windows/shell/CommandState/Done"/></rsp:ReceiveResponse></s:Envelope>`

  it("keeps polling after the server's OperationTimeout fault and gives Receive a budget above 60 s", async () => {
    const timedOut =
      "<s:Envelope><s:Fault><s:Text>The WS-Management service cannot complete the operation within the time specified in OperationTimeout.</s:Text></s:Fault></s:Envelope>"
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(timedOut, { status: 500 }))
      .mockResolvedValueOnce(new Response(streamDone("[]"), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { stdout, stderr } = await (new WinRMClient(conn) as any).receiveOutput("shell-1", "c1")

    expect(stdout).toBe("[]")
    expect(stderr).toBe("")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      expect(call[1].body).toContain("<wsman:OperationTimeout>PT60S</wsman:OperationTimeout>")
      expect(call[1].signal).toBeInstanceOf(AbortSignal)
    }
  })

  it("still surfaces a real fault from Receive", async () => {
    const denied = "<s:Envelope><s:Fault><s:Text>Access is denied.</s:Text></s:Fault></s:Envelope>"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(denied, { status: 500 })))

    await expect((new WinRMClient(conn) as any).receiveOutput("shell-1", "c1")).rejects.toThrow("Access is denied.")
  })
})

describe("cleanPowerShellStderr", () => {
  it("drops CLIXML progress records (module preparation) so they never count as an error", () => {
    const clixml = `#< CLIXML
<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T><T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Préparation des modules à la première utilisation.</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC><T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj></Objs>`
    expect(cleanPowerShellStderr(clixml)).toBe("")
  })

  it("keeps the error strings of a CLIXML stream, decoded", () => {
    const clixml = `#< CLIXML
<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><MS><PR N="Record"><AV>x</AV></PR></MS></Obj><S S="Error">Get-VM : The term &apos;Get-VM&apos; is not recognized_x000D__x000A_</S><S S="Error">At line:1 char:1_x000D__x000A_</S></Objs>`
    expect(cleanPowerShellStderr(clixml)).toBe("Get-VM : The term 'Get-VM' is not recognized\nAt line:1 char:1")
  })

  it("returns plain-text stderr unchanged", () => {
    expect(cleanPowerShellStderr("  Access is denied.\n")).toBe("Access is denied.")
  })
})
