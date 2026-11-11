/**
 * A tenant admin manages the tenant's own OIDC connection, once the provider
 * opened it (issue #1289, lot 2). Real Postgres schema; the session tenant,
 * the permission check and the audit sink are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { prismaTest, truncate } from "@/__tests__/setup/prisma-test"

const { currentTenantMock, checkPermissionMock, requireProviderAdminMock, auditMock } = vi.hoisted(() => ({
  currentTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  requireProviderAdminMock: vi.fn(),
  auditMock: vi.fn(async (_e: Record<string, unknown>) => "id"),
}))

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaTest }))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: currentTenantMock }))
vi.mock("@/lib/rbac", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rbac")>("@/lib/rbac")
  return { ...actual, checkPermission: checkPermissionMock }
})
vi.mock("@/lib/tenant/providerGuard", () => ({ requireProviderAdmin: requireProviderAdminMock }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
vi.mock("@/lib/crypto/secret", () => ({
  encryptSecret: (v: string) => `enc(${v})`,
  decryptSecret: (v: string) => v.replace(/^enc\((.*)\)$/, "$1"),
}))

const tenantRoute = await import("../route")
const tenantTest = await import("../test/route")
const providerRoute = await import("@/app/api/v1/auth/oidc/connections/[tenantId]/route")

const T = "t-acme"
const now = new Date()
const PUBLIC_ISSUER = "https://93.184.216.34/realms/acme"

const body = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  provider_name: "Acme SSO",
  issuer_url: PUBLIC_ISSUER,
  client_id: "pxc",
  client_secret: "s3cret",
  default_role: "role_tenant_viewer",
  allowed_domains: "acme.example",
  group_role_mapping: [],
  ...overrides,
})

async function setSelfService(on: boolean) {
  await prismaTest.tenant.update({ where: { id: T }, data: { oidcSelfService: on } })
  if (on) {
    await prismaTest.oidcConfig.upsert({
      where: { id: T },
      update: { allowedDomains: ["acme.example"] },
      create: { id: T, tenantId: T, allowedDomains: ["acme.example"], createdAt: now, updatedAt: now },
    })
  }
}

const denied = () => new Response(JSON.stringify({ error: "Permission denied" }), { status: 403 })

beforeEach(async () => {
  vi.clearAllMocks()
  await truncate(["oidc_config"])
  for (const [id, model] of [["default", null], [T, "msp"]] as const) {
    await prismaTest.tenant.upsert({
      where: { id },
      update: { oidcSelfService: false, slug: id === T ? "acme" : id, name: id === T ? "Acme" : "Provider", enabled: true },
      create: { id, slug: id === T ? "acme" : id, name: id === T ? "Acme" : "Provider", operatingModel: model, createdAt: now, updatedAt: now },
    })
  }
  await prismaTest.rbacRole.upsert({ where: { id: "role_tenant_viewer" }, update: {}, create: { id: "role_tenant_viewer", name: "Tenant Viewer", isSystem: true, createdAt: now, updatedAt: now } })
  currentTenantMock.mockResolvedValue(T)
  checkPermissionMock.mockResolvedValue(null)
  requireProviderAdminMock.mockResolvedValue(null)
})

const put = (payload: unknown) => callRoute(tenantRoute.PUT as any, { method: "PUT", body: payload as any })
const get = () => callRoute(tenantRoute.GET as any, { method: "GET" })

describe("who may reach /api/v1/tenant/identity", () => {
  it("is closed while the provider has not opened self-service, permission or not", async () => {
    expect((await get()).status).toBe(403)
    expect((await put(body())).status).toBe(403)
    expect(await prismaTest.oidcConfig.count()).toBe(0)
  })

  it("needs admin.identity once self-service is open", async () => {
    await setSelfService(true)
    checkPermissionMock.mockResolvedValue(denied())
    expect((await put(body())).status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith("admin.identity")
  })

  it("does not exist for the provider tenant, whose IdP lives elsewhere", async () => {
    currentTenantMock.mockResolvedValue("default")
    expect((await get()).status).toBe(404)
    expect((await put(body())).status).toBe(404)
  })
})

describe("a tenant admin with self-service", () => {
  beforeEach(() => setSelfService(true))

  it("reads its own connection, without the outbound proxy fields", async () => {
    const { data } = await readJson<any>(await get())
    expect(data).toMatchObject({ tenant_id: T, allowed_domains: ["acme.example"], tenants: [expect.objectContaining({ id: T })] })
    expect(data).not.toHaveProperty("proxy_url")
    expect(data).not.toHaveProperty("env_proxy")
  })

  it("offers and saves a catalogue role published to the tenant, never a service desk one (ui#1336)", async () => {
    await prismaTest.rbacRole.deleteMany({ where: { id: { startsWith: "role_cat_" } } })
    for (const [id, audience] of [["role_cat_tenant", "tenant"], ["role_cat_desk", "service_desk"]] as const) {
      await prismaTest.rbacRole.create({ data: { id, name: id, tenantId: "default", audience, createdAt: now, updatedAt: now, publications: { create: [{ tenantId: T }] } } })
    }
    const { data } = await readJson<any>(await get())
    const offered = data.roles.map((r: any) => r.id)
    expect(offered).toContain("role_cat_tenant")
    expect(offered).not.toContain("role_cat_desk")
    expect((await put(body({ group_role_mapping: [{ group: "cat", tenant: T, vdc: "", role: "role_cat_tenant" }] }))).status).toBe(200)
    expect((await put(body({ group_role_mapping: [{ group: "desk", tenant: T, vdc: "", role: "role_cat_desk" }] }))).status).toBe(400)
  })

  it("cannot change the allowed e-mail domains, which the provider owns", async () => {
    expect((await put(body({ allowed_domains: "" }))).status).toBe(200)
    expect((await prismaTest.oidcConfig.findUniqueOrThrow({ where: { id: T } })).allowedDomains).toEqual(["acme.example"])
    expect((await put(body({ allowed_domains: "provider.example, acme.example" }))).status).toBe(200)
    expect((await prismaTest.oidcConfig.findUniqueOrThrow({ where: { id: T } })).allowedDomains).toEqual(["acme.example"])
  })

  it("saves its own connection, the outbound proxy it sends being ignored", async () => {
    const res = await put(body({ proxy_url: "http://10.0.0.5:3128", proxy_username: "x", proxy_password: "y" }))
    expect(res.status).toBe(200)
    const row = await prismaTest.oidcConfig.findUniqueOrThrow({ where: { id: T } })
    expect(row).toMatchObject({ tenantId: T, issuerUrl: PUBLIC_ISSUER, proxyUrl: null, proxyPasswordEnc: null })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ resourceId: T, details: expect.objectContaining({ connection: T }) }))
  })

  it.each([
    ["plain http", { issuer_url: "http://93.184.216.34/realms/acme" }],
    ["a private issuer", { issuer_url: "https://10.0.0.1/realms/acme" }],
    ["a loopback token endpoint", { token_url: "https://127.0.0.1/token", authorization_url: "https://93.184.216.34/auth" }],
    ["a metadata userinfo endpoint", { userinfo_url: "https://169.254.169.254/latest" }],
  ])("refuses %s with a message that names no address", async (_label, overrides) => {
    const res = await put(body(overrides))
    expect(res.status).toBe(400)
    const { error } = await readJson<any>(res)
    expect(error).not.toMatch(/10\.0\.0\.1|127\.0\.0\.1|169\.254/)
    expect((await prismaTest.oidcConfig.findUniqueOrThrow({ where: { id: T } })).issuerUrl).toBe("")
  })

  describe("discovery test of a public issuer", () => {
    const testIssuer = () =>
      callRoute(tenantTest.POST as any, { method: "POST", body: { issuer_url: "https://93.184.216.34/realms/acme/" } })

    it("reads the document without following redirects and lists its endpoints", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ issuer: "i", authorization_endpoint: "a", token_endpoint: "t" }), { status: 200 }),
      )
      const body = await readJson<any>(await testIssuer())
      expect(fetchSpy.mock.calls[0][0]).toBe("https://93.184.216.34/realms/acme/.well-known/openid-configuration")
      expect((fetchSpy.mock.calls[0][1] as any).redirect).toBe("error")
      expect(body).toEqual({ success: true, endpoints: { issuer: "i", authorization_endpoint: "a", token_endpoint: "t", userinfo_endpoint: null } })
      fetchSpy.mockRestore()
    })

    it("reports a document missing what a sign-in needs, an HTTP error, and a failed request without detail", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch")
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ issuer: "i" }), { status: 200 }))
      expect((await readJson<any>(await testIssuer())).error).toMatch(/authorization_endpoint, token_endpoint/)
      fetchSpy.mockResolvedValueOnce(new Response("no", { status: 502 }))
      expect((await readJson<any>(await testIssuer())).error).toBe("Discovery endpoint returned HTTP 502")
      fetchSpy.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.9.9.9:443"))
      const failed = await readJson<any>(await testIssuer())
      expect(failed).toEqual({ success: false, error: "The discovery document could not be read" })
      fetchSpy.mockRestore()
    })

    it("reports the provider's proxy, which the real sign-in would refuse, sending nothing", async () => {
      await prismaTest.oidcConfig.update({ where: { id: T }, data: { proxyUrl: "http://proxy.corp:3128" } })
      const fetchSpy = vi.spyOn(globalThis, "fetch")
      const res = await testIssuer()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(await readJson<any>(res)).toEqual({ success: false, error: expect.stringMatching(/proxy/i) })
      fetchSpy.mockRestore()
    })

    it("is closed like the rest while self-service is off", async () => {
      await setSelfService(false)
      expect((await testIssuer()).status).toBe(403)
    })
  })

  it("tests a private issuer without sending any request to it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const res = await callRoute(tenantTest.POST as any, { method: "POST", body: { issuer_url: "https://10.0.0.1/realms/acme" } })
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe("the provider side of self-service", () => {
  const providerPut = (payload: unknown) =>
    callRoute(providerRoute.PUT as any, { method: "PUT", params: { tenantId: T }, body: payload as any })

  it("opens and closes self-service for one tenant", async () => {
    expect((await providerPut(body({ self_service: true }))).status).toBe(200)
    expect((await prismaTest.tenant.findUniqueOrThrow({ where: { id: T } })).oidcSelfService).toBe(true)
    expect((await providerPut(body({ self_service: false }))).status).toBe(200)
    expect((await prismaTest.tenant.findUniqueOrThrow({ where: { id: T } })).oidcSelfService).toBe(false)
  })

  it("refuses to open self-service without allowed e-mail domains", async () => {
    const res = await providerPut(body({ self_service: true, allowed_domains: "" }))
    expect(res.status).toBe(400)
    expect((await prismaTest.tenant.findUniqueOrThrow({ where: { id: T } })).oidcSelfService).toBe(false)
  })

  it("keeps self-service as it is when the form does not send it", async () => {
    await setSelfService(true)
    await providerPut(body())
    expect((await prismaTest.tenant.findUniqueOrThrow({ where: { id: T } })).oidcSelfService).toBe(true)
  })

  it("applies the same address rules to a self-service tenant's connection, even saved by the provider", async () => {
    await setSelfService(true)
    expect((await providerPut(body({ issuer_url: "https://10.0.0.1/realms/acme" }))).status).toBe(400)
  })

  it("checks a provider-managed tenant's addresses too, unless the provider trusts its IdP", async () => {
    expect((await providerPut(body({ issuer_url: "https://10.0.0.1/realms/acme" }))).status).toBe(400)
    expect((await providerPut(body({ issuer_url: "https://10.0.0.1/realms/acme", trusted_endpoints: true }))).status).toBe(200)
    expect((await prismaTest.oidcConfig.findUniqueOrThrow({ where: { id: T } })).trustedEndpoints).toBe(true)
  })

  it("keeps a trusted connection trusted when the form does not send the flag", async () => {
    await providerPut(body({ issuer_url: "https://10.0.0.1/realms/acme", trusted_endpoints: true }))
    expect((await providerPut(body({ issuer_url: "https://10.0.0.1/realms/acme" }))).status).toBe(200)
  })

  it("checks a self-service tenant's addresses even when the provider trusted its IdP before", async () => {
    await providerPut(body({ issuer_url: "https://10.0.0.1/realms/acme", trusted_endpoints: true }))
    expect((await providerPut(body({ issuer_url: "https://10.0.0.1/realms/acme", self_service: true }))).status).toBe(400)
  })

  it("drops the trust when it opens self-service, so closing it later checks the tenant's choices", async () => {
    await providerPut(body({ issuer_url: "https://10.0.0.1/realms/acme", trusted_endpoints: true }))
    expect((await providerPut(body({ self_service: true, trusted_endpoints: true }))).status).toBe(200)
    expect((await prismaTest.oidcConfig.findUniqueOrThrow({ where: { id: T } })).trustedEndpoints).toBe(false)
    expect((await providerPut(body({ issuer_url: "https://10.0.0.1/realms/acme", self_service: false }))).status).toBe(400)
  })

  it("never lets the tenant mark its own IdP as trusted", async () => {
    await setSelfService(true)
    expect((await put(body({ trusted_endpoints: true }))).status).toBe(200)
    expect((await prismaTest.oidcConfig.findUniqueOrThrow({ where: { id: T } })).trustedEndpoints).toBe(false)
  })

  it("refuses a checked connection behind an outbound proxy, whose lookups escape the checks", async () => {
    const res = await providerPut(body({ proxy_url: "http://proxy.corp:3128" }))
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/proxy/i)
    expect((await providerPut(body({ proxy_url: "http://proxy.corp:3128", proxy_bypass: "93.184.216.34" }))).status).toBe(200)
    expect((await providerPut(body({ proxy_url: "http://proxy.corp:3128", trusted_endpoints: true }))).status).toBe(200)
  })

  it("refuses a self-service tenant's save while the provider's proxy applies to its IdP", async () => {
    await setSelfService(true)
    await prismaTest.oidcConfig.update({ where: { id: T }, data: { proxyUrl: "http://proxy.corp:3128" } })
    expect((await put(body())).status).toBe(400)
  })
})

describe("admin.identity", () => {
  it("is in the catalogue, dangerous, and part of the tenant admin role", async () => {
    const { ALL_PERMISSIONS, ROLES } = await import("../../../../../../../prisma/roleCatalogue")
    expect(ALL_PERMISSIONS.find(p => p.id === "admin.identity")).toMatchObject({ category: "admin", isDangerous: true })
    expect(ROLES.find(r => r.id === "role_tenant_admin")?.permissions).toContain("admin.identity")
  })
})
