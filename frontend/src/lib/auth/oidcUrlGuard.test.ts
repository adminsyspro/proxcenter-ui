/**
 * The server-side requests a tenant-configured IdP makes this server send
 * (discovery, token, keys, userinfo) may only reach public HTTPS hosts
 * (issue #1289, lot 2): checked when the URL is saved, and again at connect
 * time, so a name that later resolves inside the network is still refused.
 */
import { describe, expect, it } from "vitest"

import { assertPublicHttpsUrl, isPublicAddress, OidcUrlRefused, strictLookup } from "./oidcUrlGuard"

const resolver = (map: Record<string, string[]>) => async (host: string) => map[host] ?? []

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "100.64.0.1", "169.254.169.254", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fd00::1", "fe80::1", "fd00:ec2::254", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "192.0.0.192", "not-an-ip",
  ])("refuses %s", ip => {
    expect(isPublicAddress(ip)).toBe(false)
  })

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:93.184.216.34"])("accepts %s", ip => {
    expect(isPublicAddress(ip)).toBe(true)
  })
})

describe("assertPublicHttpsUrl", () => {
  it("accepts an https URL whose every address is public", async () => {
    const url = await assertPublicHttpsUrl("https://idp.acme.example/realms/a", resolver({ "idp.acme.example": ["93.184.216.34"] }))
    expect(url.hostname).toBe("idp.acme.example")
  })

  it.each([
    ["plain http", "http://idp.acme.example", { "idp.acme.example": ["93.184.216.34"] }],
    ["a loopback literal", "https://127.0.0.1/realms/a", {}],
    ["a private literal", "https://10.1.2.3", {}],
    ["a metadata literal", "https://169.254.169.254/latest", {}],
    ["an IPv6 loopback literal", "https://[::1]/", {}],
    ["an IPv6 unique local literal", "https://[fd00::1]/", {}],
    ["a name resolving to a private address", "https://intranet.acme.example", { "intranet.acme.example": ["192.168.1.1"] }],
    ["a name with one public and one private address", "https://mixed.acme.example", { "mixed.acme.example": ["93.184.216.34", "10.0.0.1"] }],
    ["a name that does not resolve", "https://ghost.acme.example", {}],
    ["something that is not a URL", "not a url", {}],
  ])("refuses %s", async (_label, url, map) => {
    await expect(assertPublicHttpsUrl(url, resolver(map))).rejects.toBeInstanceOf(OidcUrlRefused)
  })

  it("refuses with a message that does not echo the resolved address", async () => {
    const err = await assertPublicHttpsUrl("https://intranet.acme.example", resolver({ "intranet.acme.example": ["192.168.1.1"] })).catch(e => e)
    expect(String(err.message)).not.toContain("192.168.1.1")
  })
})

describe("strictLookup (connect time)", () => {
  function lookupWith(addresses: Array<{ address: string; family: number }>) {
    const resolve = (_host: string, _opts: unknown, cb: (err: Error | null, addrs: typeof addresses) => void) => cb(null, addresses)
    return strictLookup(resolve as any) as any
  }

  it("hands back a public address", async () => {
    const lookup = lookupWith([{ address: "93.184.216.34", family: 4 }])
    const out = await new Promise<any>((resolve, reject) =>
      lookup("idp.acme.example", { family: 0 }, (err: Error | null, address: string, family: number) => (err ? reject(err) : resolve({ address, family }))),
    )
    expect(out).toEqual({ address: "93.184.216.34", family: 4 })
  })

  it("supports the all-addresses form", async () => {
    const lookup = lookupWith([{ address: "93.184.216.34", family: 4 }])
    const out = await new Promise<any>((resolve, reject) =>
      lookup("idp.acme.example", { all: true }, (err: Error | null, addrs: unknown) => (err ? reject(err) : resolve(addrs))),
    )
    expect(out).toEqual([{ address: "93.184.216.34", family: 4 }])
  })

  it("fails when the name now resolves inside the network (DNS rebinding)", async () => {
    const lookup = lookupWith([{ address: "127.0.0.1", family: 4 }])
    const err = await new Promise<any>(resolve => lookup("idp.acme.example", {}, (e: Error | null) => resolve(e)))
    expect(err).toBeInstanceOf(OidcUrlRefused)
  })
})
