/**
 * Tests for GET /api/v1/auth/providers, focused on the SSO-only login flags
 * surfaced to the login page (showLocalLogin / forceSsoRedirect).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const isOidcEnabledMock = vi.fn()
const getOidcConfigMock = vi.fn()
const isLdapEnabledMock = vi.fn()

vi.mock("@/lib/auth/oidc", () => ({
  isOidcEnabled: isOidcEnabledMock,
  getOidcConfig: getOidcConfigMock,
}))

vi.mock("@/lib/auth/ldap", () => ({ isLdapEnabled: isLdapEnabledMock }))

async function importGET() {
  const mod = await import("../route")
  return mod.GET
}

beforeEach(() => {
  vi.clearAllMocks()
  isLdapEnabledMock.mockResolvedValue(false)
})

describe("GET /api/v1/auth/providers", () => {
  it("returns safe defaults and does not read the config when OIDC is disabled", async () => {
    isOidcEnabledMock.mockResolvedValue(false)
    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.oidcEnabled).toBe(false)
    expect(body.showLocalLogin).toBe(true)
    expect(body.forceSsoRedirect).toBe(false)
    expect(body.oidcProviderName).toBe("SSO")
    expect(getOidcConfigMock).not.toHaveBeenCalled()
  })

  it("surfaces the persisted flags when OIDC is enabled", async () => {
    isOidcEnabledMock.mockResolvedValue(true)
    getOidcConfigMock.mockResolvedValue({
      providerName: "Okta",
      showLocalLogin: false,
      forceSsoRedirect: true,
    })
    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    const body = await readJson<any>(res)
    expect(body.oidcEnabled).toBe(true)
    expect(body.oidcProviderName).toBe("Okta")
    expect(body.showLocalLogin).toBe(false)
    expect(body.forceSsoRedirect).toBe(true)
  })

  it("falls back to safe defaults when OIDC is enabled but the config is missing", async () => {
    isOidcEnabledMock.mockResolvedValue(true)
    getOidcConfigMock.mockResolvedValue(null)
    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    const body = await readJson<any>(res)
    expect(body.oidcProviderName).toBe("SSO")
    expect(body.showLocalLogin).toBe(true)
    expect(body.forceSsoRedirect).toBe(false)
  })

  it("returns the visible-local-form fallback when a probe throws", async () => {
    isOidcEnabledMock.mockRejectedValue(new Error("db down"))
    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.credentialsEnabled).toBe(true)
    expect(body.oidcEnabled).toBe(false)
    expect(body.showLocalLogin).toBe(true)
    expect(body.forceSsoRedirect).toBe(false)
  })
})
