/**
 * IdP metadata and per-connection HTTP options (issue #1289). openid-client
 * keeps ONE process-wide set of default HTTP options, which NextAuth overwrites
 * for whichever provider it builds last: with several connections, a request of
 * one could go out with another's agent (a strict tenant's through a plain
 * agent, or the provider's internal IdP through the strict one). So discovery
 * is ours, and every connection's own options travel with its own client.
 */
import https from "node:https"

import { beforeEach, describe, expect, it } from "vitest"

import { clearOidcProxyAgents } from "./oidcProxy"
import { OidcUrlRefused } from "./oidcUrlGuard"
import { clearOidcMetadataCache, connectionHttpOptions, discoveryUrlOf, resolveOidcMetadata } from "./oidcMetadata"

const base = (over: Record<string, unknown> = {}) =>
  ({
    id: "t-acme",
    tenantId: "t-acme",
    issuerUrl: "https://idp.acme.example/realms/a//",
    authorizationUrl: null,
    tokenUrl: null,
    userinfoUrl: null,
    proxyUrl: null,
    proxyUsername: null,
    proxyPassword: null,
    proxyBypass: null,
    strictUrls: false,
    ...over,
  }) as any

const DOC = {
  issuer: "https://idp.acme.example/realms/a",
  authorization_endpoint: "https://idp.acme.example/realms/a/auth",
  token_endpoint: "https://idp.acme.example/realms/a/token",
  userinfo_endpoint: "https://idp.acme.example/realms/a/userinfo",
  jwks_uri: "https://idp.acme.example/realms/a/certs",
}

function fetchOf(doc: Record<string, unknown>, calls: any[] = []) {
  return (async (url: string, init: any) => {
    calls.push([url, init])
    return new Response(JSON.stringify(doc), { status: 200 })
  }) as unknown as typeof fetch
}

const publicResolver = async () => ["93.184.216.34"]

beforeEach(() => {
  clearOidcMetadataCache()
  clearOidcProxyAgents()
})

describe("discoveryUrlOf", () => {
  it("trims every trailing slash of the issuer", () => {
    expect(discoveryUrlOf("https://idp.example.com/realms/x//")).toBe("https://idp.example.com/realms/x/.well-known/openid-configuration")
    expect(discoveryUrlOf("https://idp.example.com/realms/x")).toBe("https://idp.example.com/realms/x/.well-known/openid-configuration")
  })
})

describe("resolveOidcMetadata", () => {
  it("uses the manual endpoints as typed, without any request", async () => {
    const calls: any[] = []
    const m = await resolveOidcMetadata(base({ authorizationUrl: "https://idp/auth", tokenUrl: "https://idp/token", issuerUrl: "https://idp/x//" }), { fetchImpl: fetchOf(DOC, calls) })
    expect(calls).toEqual([])
    expect(m).toMatchObject({ issuer: "https://idp/x//", authorization_endpoint: "https://idp/auth", token_endpoint: "https://idp/token" })
  })

  it("reads the discovery document once, then from the cache", async () => {
    const calls: any[] = []
    const fetchImpl = fetchOf(DOC, calls)
    expect(await resolveOidcMetadata(base(), { fetchImpl })).toEqual(DOC)
    await resolveOidcMetadata(base(), { fetchImpl })
    expect(calls.map(c => c[0])).toEqual(["https://idp.acme.example/realms/a/.well-known/openid-configuration"])
  })

  it("refuses a document without the endpoints a sign-in needs", async () => {
    await expect(resolveOidcMetadata(base(), { fetchImpl: fetchOf({ issuer: "x" }) })).rejects.toThrow()
  })

  it("never follows a redirect for a strict connection", async () => {
    const calls: any[] = []
    await resolveOidcMetadata(base({ strictUrls: true }), { fetchImpl: fetchOf(DOC, calls), resolve: publicResolver })
    expect(calls[0][1].redirect).toBe("error")
    expect(calls[0][1].dispatcher).toBeDefined()
  })

  it.each([
    ["token", { token_endpoint: "https://10.0.0.5/token" }],
    ["keys", { jwks_uri: "https://169.254.169.254/latest/meta-data" }],
    ["userinfo", { userinfo_endpoint: "https://127.0.0.1/userinfo" }],
    ["plain http token", { token_endpoint: "http://idp.acme.example/token" }],
  ])("refuses a strict connection whose document names an internal %s endpoint", async (_l, over) => {
    await expect(
      resolveOidcMetadata(base({ strictUrls: true }), { fetchImpl: fetchOf({ ...DOC, ...over }), resolve: async (h: string) => (h === "idp.acme.example" ? ["93.184.216.34"] : []) }),
    ).rejects.toBeInstanceOf(OidcUrlRefused)
  })

  it("refuses a strict connection behind a proxy before sending anything", async () => {
    const calls: any[] = []
    await expect(
      resolveOidcMetadata(base({ strictUrls: true, proxyUrl: "http://proxy.corp:3128" }), { fetchImpl: fetchOf(DOC, calls), resolve: publicResolver }),
    ).rejects.toBeInstanceOf(OidcUrlRefused)
    expect(calls).toEqual([])
  })

  it("lets a connection the provider trusts use internal endpoints", async () => {
    const m = await resolveOidcMetadata(base({ strictUrls: false }), { fetchImpl: fetchOf({ ...DOC, token_endpoint: "https://10.0.0.5/token" }) })
    expect(m.token_endpoint).toBe("https://10.0.0.5/token")
  })
})

describe("connectionHttpOptions", () => {
  it("gives a strict connection the agent that checks every address, whatever the defaults", () => {
    const opts = connectionHttpOptions(base({ strictUrls: true }))(new URL("https://idp.acme.example/token"), {})
    expect(opts.agent).toBeInstanceOf(https.Agent)
    expect(opts.timeout).toBe(10000)
  })

  it("gives a plain connection a one-off direct agent (false), never another connection's", () => {
    const opts = connectionHttpOptions(base({ strictUrls: false }))(new URL("https://idp.acme.example/token"), {})
    expect(opts.agent).toBe(false)
  })

  it("routes through the connection's own proxy", () => {
    const opts = connectionHttpOptions(base({ proxyUrl: "http://proxy.corp:3128" }))(new URL("https://idp.acme.example/token"), {})
    expect(opts.agent).toBeInstanceOf(https.Agent)
  })
})
