import { describe, it, expect } from "vitest"
import { Agent } from "undici"

import { NutanixClient } from "./client"

function agentOptions(agent: object): Record<string, any> {
  const key = Object.getOwnPropertySymbols(agent).find((s) => s.description === "options")!
  return (agent as any)[key]
}

const conn = { baseUrl: "https://prism.example:9440/", username: "admin", password: "pw" }

describe("NutanixClient fetch options", () => {
  it("attaches an insecure Agent pinned to HTTP/1.1 when insecureTLS is set", async () => {
    const client = new NutanixClient({ ...conn, insecureTLS: true })
    const opts = await (client as any).fetchOpts()

    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from("admin:pw").toString("base64")}`)
    expect(opts.headers["Accept-Encoding"]).toBe("identity")
    expect(opts.dispatcher).toBeInstanceOf(Agent)
    expect(agentOptions(opts.dispatcher).allowH2).toBe(false)
    expect(agentOptions(opts.dispatcher).connect.rejectUnauthorized).toBe(false)
    await opts.dispatcher.destroy()
  })

  it("passes no dispatcher when the certificate is validated", async () => {
    const opts = await (new NutanixClient(conn) as any).fetchOpts()
    expect(opts.dispatcher).toBeUndefined()
  })
})
