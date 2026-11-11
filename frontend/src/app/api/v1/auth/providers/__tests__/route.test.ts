/**
 * Tests for GET /api/v1/auth/providers, focused on the SSO-only login flags
 * surfaced to the login page (showLocalLogin / forceSsoRedirect).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const isOidcEnabledMock = vi.fn()
const getOidcConfigMock = vi.fn()
const isLdapEnabledMock = vi.fn()
const tenantBySlugMock = vi.fn()

vi.mock("@/lib/auth/oidc", () => ({
  isOidcEnabled: isOidcEnabledMock,
  getOidcConfig: getOidcConfigMock,
}))

vi.mock("@/lib/auth/ldap", () => ({ isLdapEnabled: isLdapEnabledMock }))
vi.mock("@/lib/auth/oidcConnections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/oidcConnections")>("@/lib/auth/oidcConnections")
  return { ...actual, getActiveTenantConnectionBySlug: tenantBySlugMock }
})

async function importGET() {
  const mod = await import("../route")
  return mod.GET
}

beforeEach(() => {
  vi.clearAllMocks()
  isLdapEnabledMock.mockResolvedValue(false)
  tenantBySlugMock.mockResolvedValue(null)
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

describe("GET /api/v1/auth/providers?tenant=<slug> (issue #1289)", () => {
  const provider = { providerName: "Provider SSO", showLocalLogin: true, forceSsoRedirect: false }
  const get = async (searchParams?: Record<string, string>) => {
    const GET = await importGET()
    return readJson<any>(await callRoute(GET as any, { method: "GET", searchParams }))
  }

  beforeEach(() => {
    isOidcEnabledMock.mockResolvedValue(true)
    getOidcConfigMock.mockResolvedValue(provider)
  })

  it("names the provider IdP's NextAuth id without a tenant", async () => {
    const body = await get()
    expect(body.oidcProviderId).toBe("oidc")
    expect(tenantBySlugMock).not.toHaveBeenCalled()
  })

  it("answers with the tenant's own IdP and login flags", async () => {
    tenantBySlugMock.mockResolvedValue({ id: "t-acme", providerName: "Acme SSO", showLocalLogin: false, forceSsoRedirect: true })
    const body = await get({ tenant: "acme" })
    expect(tenantBySlugMock).toHaveBeenCalledWith("acme")
    expect(body).toMatchObject({ oidcEnabled: true, oidcProviderId: "oidc-t-acme", oidcProviderName: "Acme SSO", showLocalLogin: false, forceSsoRedirect: true })
  })

  it("answers an unknown slug, or one without a live IdP, exactly like /login", async () => {
    const plain = await get()
    expect(await get({ tenant: "ghost" })).toEqual(plain)
  })
})
