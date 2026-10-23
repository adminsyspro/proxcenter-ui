/**
 * POST /api/v1/auth/oidc/test is the companion of the platform-wide OIDC
 * config: provider tenant only, like the config itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const requireProviderAdminMock = vi.fn()

vi.mock("@/lib/rbac", () => ({ PERMISSIONS: { ADMIN_SETTINGS: "admin.settings" } }))
vi.mock("@/lib/tenant/providerGuard", () => ({ requireProviderAdmin: requireProviderAdminMock }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => "audit-id") }))

const getOidcConfigMock = vi.fn()
vi.mock("@/lib/auth/oidc", () => ({ getOidcConfig: getOidcConfigMock }))

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv("HTTPS_PROXY", "")
  vi.stubEnv("HTTP_PROXY", "")
  vi.stubEnv("NO_PROXY", "")
  requireProviderAdminMock.mockResolvedValue(null)
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      issuer: "https://idp.example.com",
      authorization_endpoint: "https://idp.example.com/auth",
      token_endpoint: "https://idp.example.com/token",
    }),
  })
})

describe("POST /api/v1/auth/oidc/test", () => {
  it("refuses a customer tenant admin before any discovery call", async () => {
    requireProviderAdminMock.mockResolvedValue(new Response("forbidden", { status: 403 }))
    const { POST } = await import("./route")
    const res = await callRoute(POST as any, { method: "POST", body: { issuer_url: "https://idp.example.com" } })
    expect(res.status).toBe(403)
    expect(requireProviderAdminMock).toHaveBeenCalledWith("admin.settings")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("runs the discovery for a provider admin", async () => {
    const { POST } = await import("./route")
    const res = await callRoute(POST as any, { method: "POST", body: { issuer_url: "https://idp.example.com/" } })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).success).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe("https://idp.example.com/.well-known/openid-configuration")
  })
})

describe("POST /api/v1/auth/oidc/test — outbound proxy (roadmap#78)", () => {
  const issuer = "https://idp.example.com"

  it("goes direct and says so when no proxy is set", async () => {
    const { POST } = await import("./route")
    const body = await readJson<any>(await callRoute(POST as any, { method: "POST", body: { issuer_url: issuer } }))
    expect(body).toMatchObject({ success: true, via: "direct" })
    expect(fetchMock.mock.calls[0][1].dispatcher).toBeUndefined()
  })

  it("tries the proxy typed in the form, before it is saved", async () => {
    const { ProxyAgent } = await import("undici")
    const { POST } = await import("./route")
    const res = await callRoute(POST as any, {
      method: "POST",
      body: { issuer_url: issuer, proxy_url: "http://proxy.corp:3128/", proxy_username: "svc", proxy_password: "pw" },
    })
    expect(await readJson<any>(res)).toMatchObject({ success: true, via: "proxy", proxy: "http://proxy.corp:3128", proxy_source: "settings" })
    expect(fetchMock.mock.calls[0][1].dispatcher).toBeInstanceOf(ProxyAgent)
    expect(getOidcConfigMock).not.toHaveBeenCalled()
  })

  it("reuses the saved password when the field is blank and the username is unchanged", async () => {
    getOidcConfigMock.mockResolvedValue({ proxyUsername: "svc", proxyPassword: "saved-pw" })
    const { POST } = await import("./route")
    const res = await callRoute(POST as any, {
      method: "POST",
      body: { issuer_url: issuer, proxy_url: "http://proxy-saved.corp:3128", proxy_username: "svc", proxy_password: "" },
    })
    expect((await readJson<any>(res)).via).toBe("proxy")
    expect(getOidcConfigMock).toHaveBeenCalledTimes(1)
  })

  it("falls back to HTTPS_PROXY and honours the bypass list", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://squid.corp:3128")
    const { POST } = await import("./route")
    let body = await readJson<any>(await callRoute(POST as any, { method: "POST", body: { issuer_url: issuer } }))
    expect(body).toMatchObject({ via: "proxy", proxy: "http://squid.corp:3128", proxy_source: "environment" })

    body = await readJson<any>(await callRoute(POST as any, { method: "POST", body: { issuer_url: issuer, proxy_bypass: ".example.com" } }))
    expect(body.via).toBe("direct")
  })

  it("rejects an invalid proxy URL before any call", async () => {
    const { POST } = await import("./route")
    const res = await callRoute(POST as any, { method: "POST", body: { issuer_url: issuer, proxy_url: "ftp://proxy.corp" } })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("explains a DNS failure instead of answering \"fetch failed\"", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND idp.example.com"), { code: "ENOTFOUND", hostname: "idp.example.com" }),
      }),
    )
    const { POST } = await import("./route")
    const res = await callRoute(POST as any, { method: "POST", body: { issuer_url: issuer } })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body).toMatchObject({ success: false, error_code: "dns", error_host: "idp.example.com", via: "direct" })
    expect(body.error).toMatch(/Cannot resolve idp\.example\.com/)
  })

  it("reports a proxy that asks for authentication", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("Request was cancelled."), {
          cause: Object.assign(new Error("Proxy response (407) !== 200 when HTTP Tunneling"), { name: "AbortError", code: "UND_ERR_ABORTED" }),
        }),
      }),
    )
    const { POST } = await import("./route")
    const body = await readJson<any>(await callRoute(POST as any, { method: "POST", body: { issuer_url: issuer, proxy_url: "http://proxy.corp:3128" } }))
    expect(body).toMatchObject({ error_code: "proxy_auth", error_status: 407, error_host: "proxy.corp:3128", via: "proxy" })
  })
})
