/**
 * Provider-side API of the tenants' own OIDC connections (issue #1289), against
 * a real Postgres schema. The provider gate and the audit sink are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { prismaTest, truncate } from "@/__tests__/setup/prisma-test"

const { requireProviderAdminMock, auditMock } = vi.hoisted(() => ({
  requireProviderAdminMock: vi.fn(),
  auditMock: vi.fn(async (_e: Record<string, unknown>) => "id"),
}))

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaTest }))
vi.mock("@/lib/tenant/providerGuard", () => ({ requireProviderAdmin: requireProviderAdminMock }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
vi.mock("@/lib/crypto/secret", () => ({
  encryptSecret: (v: string) => `enc(${v})`,
  decryptSecret: (v: string) => v.replace(/^enc\((.*)\)$/, "$1"),
}))

const list = await import("../route")
const one = await import("../[tenantId]/route")

const T = "t-acme"
const OTHER = "t-other"
const now = new Date()

async function tenant(id: string, name: string) {
  await prismaTest.tenant.upsert({
    where: { id },
    update: { slug: id.replace(/^t-/, ""), name, oidcSelfService: false },
    create: { id, slug: id.replace(/^t-/, ""), name, operatingModel: id === "default" ? null : "msp", createdAt: now, updatedAt: now },
  })
}

const body = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  provider_name: "Acme SSO",
  issuer_url: "https://93.184.216.34/realms/acme",
  client_id: "pxc",
  client_secret: "s3cret",
  scopes: "openid profile email",
  default_role: "role_tenant_viewer",
  allowed_domains: "acme.example, @Acme.example",
  group_role_mapping: [{ group: "ops", tenant: T, vdc: "", role: "role_tenant_operator" }],
  ...overrides,
})

const put = (tenantId: string, payload: unknown) =>
  callRoute(one.PUT as any, { method: "PUT", params: { tenantId }, body: payload as any })
const getOne = (tenantId: string) => callRoute(one.GET as any, { method: "GET", params: { tenantId } })

beforeEach(async () => {
  vi.clearAllMocks()
  requireProviderAdminMock.mockResolvedValue(null)
  await truncate(["oidc_config"])
  await tenant("default", "Provider")
  await tenant(T, "Acme")
  await tenant(OTHER, "Other Co")
  for (const id of ["role_tenant_viewer", "role_tenant_operator", "role_viewer", "role_super_admin"]) {
    await prismaTest.rbacRole.upsert({ where: { id }, update: {}, create: { id, name: id, isSystem: true, createdAt: now, updatedAt: now } })
  }
  await prismaTest.rbacPermission.upsert({ where: { id: "vm.config.nic.vlan" }, update: {}, create: { id: "vm.config.nic.vlan", name: "vm.config.nic.vlan", category: "vm", isDangerous: true } })
  await prismaTest.rbacRole.upsert({ where: { id: "role_acme_net" }, update: {}, create: { id: "role_acme_net", name: "Acme network", tenantId: T, createdAt: now, updatedAt: now } })
  await prismaTest.rbacRolePermission.upsert({
    where: { roleId_permissionId: { roleId: "role_acme_net", permissionId: "vm.config.nic.vlan" } },
    update: {},
    create: { roleId: "role_acme_net", permissionId: "vm.config.nic.vlan" },
  })
  await prismaTest.rbacRole.upsert({ where: { id: "role_other_custom" }, update: {}, create: { id: "role_other_custom", name: "Other custom", tenantId: OTHER, createdAt: now, updatedAt: now } })
})

describe("provider gate", () => {
  it("refuses everything when the caller is not a provider admin", async () => {
    requireProviderAdminMock.mockResolvedValue(new Response(JSON.stringify({ error: "denied" }), { status: 403 }))
    expect((await callRoute(list.GET as any, { method: "GET" })).status).toBe(403)
    expect((await getOne(T)).status).toBe(403)
    expect((await put(T, body())).status).toBe(403)
    expect((await callRoute(one.DELETE as any, { method: "DELETE", params: { tenantId: T } })).status).toBe(403)
    expect(await prismaTest.oidcConfig.count()).toBe(0)
  })
})

describe("PUT /api/v1/auth/oidc/connections/[tenantId]", () => {
  it("saves the tenant's connection under its tenant id, secret encrypted, domains normalised", async () => {
    const res = await put(T, body())
    expect(res.status).toBe(200)
    const row = await prismaTest.oidcConfig.findUniqueOrThrow({ where: { id: T } })
    expect(row).toMatchObject({ tenantId: T, enabled: true, clientId: "pxc", clientSecretEnc: "enc(s3cret)", allowedDomains: ["acme.example"] })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: "oidc_config", resourceId: T, details: expect.objectContaining({ connection: T, clientSecretChanged: true }),
    }))
  })

  it("keeps the stored secret when none is typed", async () => {
    await put(T, body())
    await put(T, body({ client_secret: "", provider_name: "Renamed" }))
    const row = await prismaTest.oidcConfig.findUniqueOrThrow({ where: { id: T } })
    expect(row).toMatchObject({ providerName: "Renamed", clientSecretEnc: "enc(s3cret)" })
  })

  it("never edits the provider IdP through this route", async () => {
    expect((await put("default", body())).status).toBe(400)
    expect(await prismaTest.oidcConfig.findUnique({ where: { id: "default" } })).toBeNull()
  })

  it("answers 404 for an unknown tenant", async () => {
    expect((await put("t-ghost", body())).status).toBe(404)
  })

  it.each([
    ["a provider role", { group_role_mapping: [{ group: "x", tenant: T, vdc: "", role: "role_viewer" }] }],
    ["a wildcard role", { group_role_mapping: [{ group: "x", tenant: T, vdc: "", role: "super_admin" }] }],
    ["another tenant's custom role", { group_role_mapping: [{ group: "x", tenant: T, vdc: "", role: "role_other_custom" }] }],
    ["a row for another tenant", { group_role_mapping: [{ group: "x", tenant: OTHER, vdc: "", role: "role_tenant_viewer" }] }],
    ["a provider default role", { default_role: "role_super_admin" }],
    ["a tenant role with NIC identity rights", { group_role_mapping: [{ group: "x", tenant: T, vdc: "", role: "role_acme_net" }] }],
    ["an issuer that is not a URL", { issuer_url: "not a url" }],
    ["an enabled connection without client id", { client_id: "" }],
  ])("refuses %s, naming nothing outside the tenant", async (_label, overrides) => {
    const res = await put(T, body(overrides))
    expect(res.status).toBe(400)
    const { error } = await readJson<any>(res)
    expect(error).not.toMatch(/Other Co|t-other|role_other_custom|Provider/)
    expect(await prismaTest.oidcConfig.count()).toBe(0)
  })
})

describe("GET /api/v1/auth/oidc/connections/[tenantId]", () => {
  it("answers an unconfigured tenant with defaults, its login and callback URLs", async () => {
    const { data } = await readJson<any>(await getOne(T))
    expect(data).toMatchObject({ configured: false, enabled: false, default_role: "role_tenant_viewer", allowed_domains: [] })
    expect(data.callback_url).toMatch(/\/api\/auth\/callback\/oidc-t-acme$/)
    expect(data.login_url).toMatch(/\/login\/acme$/)
  })

  it("returns the saved values, never the secret, and only this tenant's pickers", async () => {
    await put(T, body())
    const { data } = await readJson<any>(await getOne(T))
    expect(data).toMatchObject({ configured: true, enabled: true, client_id: "pxc", hasClientSecret: true, allowed_domains: ["acme.example"] })
    expect(JSON.stringify(data)).not.toContain("s3cret")
    expect(data.tenants).toEqual([expect.objectContaining({ id: T })])
    const roleIds = data.roles.map((r: any) => r.id)
    expect(roleIds).toContain("role_tenant_operator")
    expect(roleIds).not.toContain("role_viewer")
    expect(roleIds).not.toContain("role_super_admin")
    expect(roleIds).not.toContain("role_other_custom")
    expect(roleIds).not.toContain("role_acme_net")
  })
})

describe("list and delete", () => {
  it("lists every customer tenant with the state of its connection, never the provider tenant", async () => {
    await put(T, body())
    const { data } = await readJson<any>(await callRoute(list.GET as any, { method: "GET" }))
    const ids = data.map((r: any) => r.tenant_id)
    expect(ids).toEqual(expect.arrayContaining([T, OTHER]))
    expect(ids).not.toContain("default")
    expect(data.find((r: any) => r.tenant_id === T)).toMatchObject({ configured: true, enabled: true, provider_name: "Acme SSO", name: "Acme" })
    expect(data.find((r: any) => r.tenant_id === OTHER)).toMatchObject({ configured: false })
  })

  it("deletes the connection, and the tenant reads as unconfigured again", async () => {
    await put(T, body())
    const res = await callRoute(one.DELETE as any, { method: "DELETE", params: { tenantId: T } })
    expect(res.status).toBe(200)
    expect(await prismaTest.oidcConfig.findUnique({ where: { id: T } })).toBeNull()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", resourceId: T }))
  })
})
