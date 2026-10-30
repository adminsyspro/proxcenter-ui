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

describe("NutanixClient VM parsing", () => {
  const parse = (entity: object) => (new NutanixClient(conn) as any).parseVmEntity(entity)

  it("keeps every NIC of nic_list with its MAC, status first", () => {
    const vm = parse({
      metadata: { uuid: "u1" },
      status: { name: "web", resources: { nic_list: [{ mac_address: "50:6b:8d:aa:bb:cc" }, { mac_address: "50:6b:8d:aa:bb:cd" }] } },
      spec: { resources: { nic_list: [{ mac_address: "50:6b:8d:00:00:01" }] } },
    })
    expect(vm.nics).toEqual([{ macAddress: "50:6b:8d:aa:bb:cc" }, { macAddress: "50:6b:8d:aa:bb:cd" }])
  })

  it("falls back to the spec, and keeps a NIC without a MAC", () => {
    const vm = parse({ metadata: { uuid: "u2" }, status: { resources: {} }, spec: { resources: { nic_list: [{}] } } })
    expect(vm.nics).toEqual([{ macAddress: "" }])
    expect(parse({ metadata: { uuid: "u3" }, status: {} }).nics).toEqual([])
  })
})
