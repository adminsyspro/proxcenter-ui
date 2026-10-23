import http from "node:http"
import https from "node:https"

import { ProxyAgent } from "undici"
import { describe, expect, it, vi, beforeEach } from "vitest"

import {
  bypassesProxy,
  checkProxyUrl,
  clearOidcProxyAgents,
  describeOidcFetchError,
  environmentProxyDisplay,
  oidcFetchDispatcher,
  oidcOpenidAgent,
  parseBypassList,
  proxyFor,
  resolveOidcProxy,
  type OidcProxyRoute,
} from "./oidcProxy"

beforeEach(() => {
  clearOidcProxyAgents()
  vi.restoreAllMocks()
})

describe("parseBypassList", () => {
  it("returns an empty list for null and empty input", () => {
    expect(parseBypassList(null)).toEqual([])
    expect(parseBypassList("")).toEqual([])
  })

  it("splits mixed commas and whitespace, lower-cases, and drops empty entries", () => {
    expect(parseBypassList(" Example.COM, ,\tLOCALHOST\n api.EXAMPLE.com ,, ")).toEqual([
      "example.com",
      "localhost",
      "api.example.com",
    ])
  })
})

describe("bypassesProxy", () => {
  it("matches every target with a wildcard", () => {
    expect(bypassesProxy(new URL("https://idp.example.com/"), ["*"])).toBe(true)
  })

  it("matches an exact host and a subdomain of a plain entry", () => {
    expect(bypassesProxy(new URL("https://example.com/"), ["example.com"])).toBe(true)
    expect(bypassesProxy(new URL("https://login.example.com/"), ["example.com"])).toBe(true)
  })

  it.each([".example.com", "*.example.com"])(
    "matches a domain and subdomain for %s without matching a suffix-only hostname",
    pattern => {
      expect(bypassesProxy(new URL("https://example.com/"), [pattern])).toBe(true)
      expect(bypassesProxy(new URL("https://login.example.com/"), [pattern])).toBe(true)
      expect(bypassesProxy(new URL("https://notexample.com/"), [pattern])).toBe(false)
    },
  )

  it("matches host:port only on the same explicit port", () => {
    expect(bypassesProxy(new URL("https://example.com:8443/"), ["example.com:8443"])).toBe(true)
    expect(bypassesProxy(new URL("https://example.com:9443/"), ["example.com:8443"])).toBe(false)
  })

  it("infers default HTTPS and HTTP ports", () => {
    expect(bypassesProxy(new URL("https://example.com/"), ["example.com:443"])).toBe(true)
    expect(bypassesProxy(new URL("http://example.com/"), ["example.com:80"])).toBe(true)
    expect(bypassesProxy(new URL("http://example.com/"), ["example.com:443"])).toBe(false)
  })

  it("matches an unbracketed IPv6 bypass entry", () => {
    expect(bypassesProxy(new URL("https://[::1]:8443/"), ["::1"])).toBe(true)
  })

  it("never matches a pattern that is empty after prefix stripping", () => {
    expect(bypassesProxy(new URL("https://example.com/"), ["."])).toBe(false)
  })
})

describe("checkProxyUrl", () => {
  it("normalises HTTP and HTTPS proxies and drops their path and trailing slash", () => {
    expect(checkProxyUrl("http://proxy.corp:3128/path/")).toEqual({
      url: "http://proxy.corp:3128",
    })
    expect(checkProxyUrl(" https://proxy.corp:8443/ ")).toEqual({
      url: "https://proxy.corp:8443",
    })
  })

  it("rejects a garbage string", () => {
    expect(checkProxyUrl("not a proxy")).toEqual({
      error: "Invalid proxy URL: expected http://host:port",
    })
  })

  it("rejects a non-HTTP proxy protocol", () => {
    expect(checkProxyUrl("socks5://proxy.corp:1080").error).toContain("only http:// and https://")
  })

  it("rejects credentials in the URL and points to both dedicated fields", () => {
    const result = checkProxyUrl("http://user:secret@proxy.corp:3128")
    expect(result.error).toContain("username")
    expect(result.error).toContain("password")
  })
})

describe("resolveOidcProxy", () => {
  it("prefers the saved settings proxy over the environment", () => {
    const route = resolveOidcProxy(
      { proxyUrl: "http://saved.proxy:3128" },
      "https:",
      { HTTPS_PROXY: "http://env.proxy:8080" },
    )
    expect(route).toMatchObject({
      display: "http://saved.proxy:3128",
      source: "settings",
    })
  })

  it("percent-encodes saved credentials without exposing them in display", () => {
    const password = "P@ss:w%rd!"
    const route = resolveOidcProxy(
      {
        proxyUrl: "http://proxy.corp:3128",
        proxyUsername: "proxy-user",
        proxyPassword: password,
      },
      "https:",
      {},
    )
    expect(route).not.toBeNull()
    const url = new URL(route!.url)
    expect(url.password).toBe(encodeURIComponent(password))
    expect(decodeURIComponent(url.password)).toBe(password)
    expect(route!.display).toBe("http://proxy.corp:3128")
    expect(route!.display).not.toContain("proxy-user")
    expect(route!.display).not.toContain(password)
  })

  it("does not add userinfo when no username is configured", () => {
    const route = resolveOidcProxy(
      { proxyUrl: "http://proxy.corp:3128", proxyPassword: "orphaned-secret" },
      "https:",
      {},
    )
    expect(new URL(route!.url).username).toBe("")
    expect(new URL(route!.url).password).toBe("")
  })

  it("uses HTTPS_PROXY for an HTTPS target", () => {
    const route = resolveOidcProxy(null, "https:", { HTTPS_PROXY: "http://secure.proxy:3128" })
    expect(route).toMatchObject({
      display: "http://secure.proxy:3128",
      source: "environment",
    })
  })

  it("falls back to HTTP_PROXY for an HTTPS target", () => {
    const route = resolveOidcProxy(null, "https:", { HTTP_PROXY: "http://fallback.proxy:3128" })
    expect(route?.display).toBe("http://fallback.proxy:3128")
  })

  it("honours the lowercase https_proxy variable", () => {
    const route = resolveOidcProxy(null, "https:", { https_proxy: "http://lower.proxy:3128" })
    expect(route?.display).toBe("http://lower.proxy:3128")
  })

  it("uses only HTTP_PROXY for an HTTP target", () => {
    expect(
      resolveOidcProxy(null, "http:", { HTTPS_PROXY: "http://secure-only.proxy:3128" }),
    ).toBeNull()
    expect(
      resolveOidcProxy(null, "http:", { HTTP_PROXY: "http://plain.proxy:3128" })?.display,
    ).toBe("http://plain.proxy:3128")
  })

  it("unions saved and environment bypass entries and removes duplicates", () => {
    const route = resolveOidcProxy(
      { proxyUrl: "http://proxy.corp:3128", proxyBypass: "LOCALHOST,example.com" },
      "https:",
      { NO_PROXY: "example.com api.internal" },
    )
    expect(route?.bypass).toEqual(["localhost", "example.com", "api.internal"])
  })

  it("falls back to the environment and warns for an invalid saved URL", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const route = resolveOidcProxy(
      { proxyUrl: "broken saved proxy" },
      "https:",
      { HTTPS_PROXY: "http://env.proxy:3128" },
    )
    expect(route?.source).toBe("environment")
    expect(route?.display).toBe("http://env.proxy:3128")
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it("returns null and warns for an invalid environment URL", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(resolveOidcProxy(null, "https:", { HTTPS_PROXY: "broken env proxy" })).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it("returns null when no proxy is configured", () => {
    expect(resolveOidcProxy(null, "https:", {})).toBeNull()
  })
})

describe("proxyFor", () => {
  const settings = {
    proxyUrl: "http://proxy.corp:3128",
    proxyBypass: "direct.example.com",
  }

  it("returns null when a string target is bypassed", () => {
    expect(proxyFor(settings, "https://direct.example.com/path", {})).toBeNull()
  })

  it("returns the route for a URL target that is not bypassed", () => {
    expect(proxyFor(settings, new URL("https://idp.example.com/path"), {})).toMatchObject({
      display: "http://proxy.corp:3128",
      source: "settings",
    })
  })
})

describe("oidcFetchDispatcher", () => {
  it("returns undefined with no configured proxy", () => {
    expect(oidcFetchDispatcher(null, "https://idp.example.com", {})).toBeUndefined()
  })

  it("returns undefined when the target is bypassed", () => {
    expect(
      oidcFetchDispatcher(
        { proxyUrl: "http://proxy.corp:3128", proxyBypass: "idp.example.com" },
        "https://idp.example.com",
        {},
      ),
    ).toBeUndefined()
  })

  it("returns an undici ProxyAgent when the target uses the proxy", () => {
    const dispatcher = oidcFetchDispatcher(
      { proxyUrl: "http://proxy.corp:3128" },
      "https://idp.example.com",
      {},
    )
    expect(dispatcher).toBeInstanceOf(ProxyAgent)
  })

  it("caches by proxy configuration and changes instance with the password", () => {
    const first = oidcFetchDispatcher(
      { proxyUrl: "http://proxy.corp:3128", proxyUsername: "u", proxyPassword: "one" },
      "https://idp.example.com",
      {},
    )
    const same = oidcFetchDispatcher(
      { proxyUrl: "http://proxy.corp:3128", proxyUsername: "u", proxyPassword: "one" },
      new URL("https://idp.example.com"),
      {},
    )
    const changed = oidcFetchDispatcher(
      { proxyUrl: "http://proxy.corp:3128", proxyUsername: "u", proxyPassword: "two" },
      "https://idp.example.com",
      {},
    )
    expect(same).toBe(first)
    expect(changed).not.toBe(first)
  })
})

describe("oidcOpenidAgent", () => {
  const settings = {
    proxyUrl: "http://proxy.corp:3128",
    proxyBypass: "localhost, .internal",
  }

  it("returns false with no configured proxy", () => {
    expect(oidcOpenidAgent(null, "https://idp.example.com", {})).toBe(false)
  })

  it("returns false for an unparsable issuer", () => {
    expect(oidcOpenidAgent(settings, "not an issuer", {})).toBe(false)
  })

  it("returns protocol-compatible HTTP and HTTPS agents", () => {
    const secureAgent = oidcOpenidAgent(settings, "https://idp.example.com", {})
    const plainAgent = oidcOpenidAgent(settings, "http://idp.example.com", {})
    expect(secureAgent).toBeInstanceOf(https.Agent)
    expect(plainAgent).toBeInstanceOf(http.Agent)
    expect(plainAgent).not.toBeInstanceOf(https.Agent)
  })

  it("returns the same cached agent for the same configuration", () => {
    const first = oidcOpenidAgent(settings, "https://idp.example.com", {})
    const second = oidcOpenidAgent(settings, "https://another.example.com", {})
    expect(second).toBe(first)
  })

  it("passes the proxy route and joined bypass list through proxyEnv", () => {
    const route = resolveOidcProxy(settings, "https:", {})
    const agent = oidcOpenidAgent(settings, "https://idp.example.com", {})
    expect(route).not.toBeNull()
    expect(agent).not.toBe(false)
    expect((agent as any).options.proxyEnv).toEqual({
      HTTP_PROXY: route!.url,
      HTTPS_PROXY: route!.url,
      NO_PROXY: route!.bypass.join(","),
    })
  })
})

describe("environmentProxyDisplay", () => {
  it("returns null when no environment proxy is set", () => {
    expect(environmentProxyDisplay({})).toBeNull()
  })

  it("strips credentials and path", () => {
    expect(environmentProxyDisplay({ HTTPS_PROXY: "http://u:p@proxy.corp:3128/x" })).toBe(
      "http://proxy.corp:3128",
    )
  })

  it("returns null for a garbage proxy URL", () => {
    expect(environmentProxyDisplay({ HTTPS_PROXY: "not a proxy" })).toBeNull()
  })
})

describe("describeOidcFetchError", () => {
  const target = "https://idp.example.com/oauth/token"
  const route = resolveOidcProxy(
    { proxyUrl: "http://proxy.corp:3128" },
    "https:",
    {},
  ) as OidcProxyRoute

  it("classifies an undici DNS error and suggests a proxy only for a direct route", () => {
    const error = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND idp.example.com"), {
        code: "ENOTFOUND",
        hostname: "idp.example.com",
      }),
    })
    const direct = describeOidcFetchError(error, target, null)
    const proxied = describeOidcFetchError(error, target, route)
    expect(direct).toMatchObject({ code: "dns", host: "idp.example.com" })
    expect(direct.message).toContain("Outbound proxy")
    expect(proxied).toMatchObject({ code: "dns", host: "idp.example.com" })
    expect(proxied.message).not.toContain("Outbound proxy")
  })

  it("classifies DOM TimeoutError and plain AbortError as timeouts", () => {
    expect(
      describeOidcFetchError(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
        target,
        null,
      ),
    ).toMatchObject({ code: "timeout", host: "idp.example.com" })
    expect(describeOidcFetchError({ name: "AbortError" }, target, null).code).toBe("timeout")
  })

  it("classifies an undici 407 tunnel response as proxy auth, not timeout", () => {
    const error = new TypeError("fetch failed", {
      cause: new Error("Request was cancelled.", {
        cause: Object.assign(
          new Error("Proxy response (407) !== 200 when HTTP Tunneling"),
          { name: "AbortError", code: "UND_ERR_ABORTED" },
        ),
      }),
    })
    const described = describeOidcFetchError(error, target, route)
    expect(described).toMatchObject({
      code: "proxy_auth",
      status: 407,
      host: "proxy.corp:3128",
    })
    expect(described.code).not.toBe("timeout")
  })

  it("classifies an undici 403 tunnel response as proxy refusal", () => {
    const error = new TypeError("fetch failed", {
      cause: new Error("Request was cancelled.", {
        cause: Object.assign(
          new Error("Proxy response (403) !== 200 when HTTP Tunneling"),
          { name: "AbortError", code: "UND_ERR_ABORTED" },
        ),
      }),
    })
    expect(describeOidcFetchError(error, target, route)).toMatchObject({
      code: "proxy_refused",
      status: 403,
      host: "proxy.corp:3128",
    })
  })

  it("classifies a Node proxy tunnel 407 as proxy auth", () => {
    const error = Object.assign(
      new Error(
        "Failed to establish tunnel to idp.example.com:443 via http://proxy:3128/: HTTP/1.1 407 Proxy Authentication Required",
      ),
      { code: "ERR_PROXY_TUNNEL" },
    )
    expect(describeOidcFetchError(error, target, route)).toMatchObject({
      code: "proxy_auth",
      status: 407,
      host: "proxy.corp:3128",
    })
  })

  it("classifies a nested TLS certificate error", () => {
    const error = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("self signed certificate"), {
        code: "SELF_SIGNED_CERT_IN_CHAIN",
      }),
    })
    expect(describeOidcFetchError(error, target, route)).toMatchObject({
      code: "tls",
      host: "idp.example.com",
    })
  })

  it("reports the proxy host for proxied ECONNREFUSED and target host for direct", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })
    expect(describeOidcFetchError(error, target, route)).toMatchObject({
      code: "unreachable",
      host: "proxy.corp:3128",
    })
    expect(describeOidcFetchError(error, target, null)).toMatchObject({
      code: "unreachable",
      host: "idp.example.com",
    })
  })

  it("redacts credentials from an otherwise unknown error", () => {
    const described = describeOidcFetchError(
      new Error("Could not use http://user:secret@proxy:3128"),
      new URL(target),
      route,
    )
    expect(described).toMatchObject({ code: "other", host: "idp.example.com" })
    expect(described.message).not.toContain("secret")
    expect(described.message).toContain("http://***@proxy:3128")
  })

  it("uses a null host for an invalid target string", () => {
    expect(describeOidcFetchError(new Error("unknown"), "not a URL", null)).toMatchObject({
      code: "other",
      host: null,
    })
  })
})

describe("resolveOidcProxy with a non-http environment proxy", () => {
  it("ignores a socks proxy from the environment and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(resolveOidcProxy(null, "https:", { HTTPS_PROXY: "socks5://proxy.corp:1080" })).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not a valid http(s) URL"))
    warn.mockRestore()
  })
})
