/**
 * Signing in through a tenant's own IdP, end to end against a real Postgres
 * schema (issue #1289). Only the audit sink is mocked: the account lookups, the
 * membership helpers, the grant sync and the disabled-tenant check all run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { prismaTest, truncate } from "../../__tests__/setup/prisma-test"

const auditMock = vi.fn(async (_entry: Record<string, unknown>) => "id")

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaTest }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))

const { authOptions } = await import("./config")

const T = "t-acme"
const OTHER = "t-other"
const now = new Date()

function signIn(provider: string, profile: Record<string, unknown>) {
  return (authOptions.callbacks as any).signIn({
    user: { id: String(profile.sub) },
    account: { provider },
    profile,
  })
}

async function tenant(id: string, enabled = true) {
  await prismaTest.tenant.upsert({
    where: { id },
    update: { enabled },
    create: { id, slug: id, name: id, enabled, operatingModel: id === "default" ? null : "msp", createdAt: now, updatedAt: now },
  })
}

async function role(id: string, tenantId: string | null = null) {
  await prismaTest.rbacRole.upsert({ where: { id }, update: {}, create: { id, name: id, tenantId, createdAt: now, updatedAt: now } })
}

async function connection(id: string, overrides: Record<string, unknown> = {}) {
  await prismaTest.oidcConfig.create({
    data: {
      id, tenantId: id, enabled: true, providerName: `IdP ${id}`, issuerUrl: `https://idp.example.test/${id}`, clientId: "pxc",
      defaultRole: "role_tenant_viewer", groupRoleMapping: [], createdAt: now, updatedAt: now, ...overrides,
    },
  })
}

async function account(id: string, email: string, extra: Record<string, unknown> = {}) {
  await prismaTest.user.create({ data: { id, email, password: "local-hash", createdAt: now, updatedAt: now, ...extra } })
}

async function grant(userId: string, roleId: string, tenantId: string) {
  await prismaTest.rbacUserRole.create({ data: { id: `g-${userId}-${roleId}`, userId, roleId, scopeType: "inherit", tenantId, grantedAt: now } })
}

const rolesOf = async (userId: string) =>
  (await prismaTest.rbacUserRole.findMany({ where: { userId }, select: { roleId: true, tenantId: true } }))
    .map(r => `${r.roleId}@${r.tenantId}`).sort()
const tenantsOf = async (userId: string) =>
  (await prismaTest.userTenant.findMany({ where: { userId }, select: { tenantId: true } })).map(r => r.tenantId).sort()

beforeEach(async () => {
  vi.clearAllMocks()
  await truncate(["oidc_config", "rbac_user_roles", "user_tenants", "sessions", "users", "rbac_role_publications"])
  await prismaTest.rbacRole.deleteMany({ where: { id: { startsWith: "role_cat_" } } })
  await tenant("default")
  await tenant(T)
  await tenant(OTHER)
  for (const r of ["role_tenant_viewer", "role_tenant_operator", "role_super_admin", "role_viewer"]) await role(r)
  await role("role_other_custom", OTHER)
})

describe("a new identity from a tenant IdP", () => {
  it("is provisioned in that tenant only, bound to the connection, with the mapped tenant role", async () => {
    await connection(T, { groupRoleMapping: [{ group: "ops", tenant: T, role: "role_tenant_operator" }] })

    expect(await signIn(`oidc-${T}`, { sub: "s-alice", email: "alice@acme.example", email_verified: true, groups: ["ops"] })).toBe(true)

    const alice = await prismaTest.user.findUniqueOrThrow({ where: { email: "alice@acme.example" } })
    expect(alice).toMatchObject({ tenantId: T, oidcConnectionId: T, oidcSub: "s-alice", authProvider: "oidc" })
    expect(await tenantsOf(alice.id)).toEqual([T])
    expect(await rolesOf(alice.id)).toEqual([`role_tenant_operator@${T}`])
  })

  it("gets the tenant default role when no mapping is configured", async () => {
    await connection(T)
    expect(await signIn(`oidc-${T}`, { sub: "s-bob", email: "bob@acme.example", groups: [] })).toBe(true)
    const bob = await prismaTest.user.findUniqueOrThrow({ where: { email: "bob@acme.example" } })
    expect(await rolesOf(bob.id)).toEqual([`role_tenant_viewer@${T}`])
    expect(await tenantsOf(bob.id)).toEqual([T])
  })

  it("never receives a provider role, even when the stored default names one", async () => {
    await connection(T, { defaultRole: "role_super_admin" })
    expect(await signIn(`oidc-${T}`, { sub: "s-eve", email: "eve@acme.example" })).toBe(true)
    const eve = await prismaTest.user.findUniqueOrThrow({ where: { email: "eve@acme.example" } })
    expect(await rolesOf(eve.id)).toEqual([`role_tenant_viewer@${T}`])
  })

  it("ignores mapping rows that reach another tenant or a provider role (stored before, or forged)", async () => {
    await connection(T, {
      groupRoleMapping: [
        { group: "g", tenant: "default", role: "role_super_admin" },
        { group: "g", tenant: OTHER, role: "role_tenant_operator" },
        { group: "g", tenant: T, role: "role_viewer" },
        { group: "g", tenant: T, role: "role_other_custom" },
      ],
    })
    expect(await signIn(`oidc-${T}`, { sub: "s-mal", email: "mal@acme.example", groups: ["g"] })).toBe(true)
    const mal = await prismaTest.user.findUniqueOrThrow({ where: { email: "mal@acme.example" } })
    expect(await rolesOf(mal.id)).toEqual([])
    expect(await tenantsOf(mal.id)).toEqual([T])
  })

  it("receives a catalogue role published to its tenant, never a service desk one (ui#1336)", async () => {
    await prismaTest.rbacRole.create({ data: { id: "role_cat_tenant", name: "Catalogue", tenantId: "default", audience: "tenant", createdAt: now, updatedAt: now, publications: { create: [{ tenantId: T }] } } })
    await prismaTest.rbacRole.create({ data: { id: "role_cat_desk", name: "Desk", tenantId: "default", audience: "service_desk", createdAt: now, updatedAt: now, publications: { create: [{ tenantId: T }] } } })
    await connection(T, {
      groupRoleMapping: [
        { group: "cat", tenant: T, role: "role_cat_tenant" },
        { group: "desk", tenant: T, role: "role_cat_desk" },
      ],
      groupMappingStrategy: "cumulative",
    })
    expect(await signIn(`oidc-${T}`, { sub: "s-cat", email: "cat@acme.example", groups: ["cat", "desk"] })).toBe(true)
    const cat = await prismaTest.user.findUniqueOrThrow({ where: { email: "cat@acme.example" } })
    expect(await rolesOf(cat.id)).toEqual([`role_cat_tenant@${T}`])
  })

  it("is refused when its domain is not allowed", async () => {
    await connection(T, { allowedDomains: ["acme.example"] })
    expect(await signIn(`oidc-${T}`, { sub: "s-x", email: "x@elsewhere.example" })).toBe("/login?error=OidcLinkRefused")
    expect(await prismaTest.user.count()).toBe(0)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "login_failed",
      details: { reason: "email_domain_not_allowed", provider: "oidc", connection: T },
    }))
  })
})

describe("an e-mail a tenant IdP does not own", () => {
  it("never takes over the super admin, even verified", async () => {
    await connection(T)
    await account("u-sa", "root@provider.example", { tenantId: "default" })
    await grant("u-sa", "role_super_admin", "default")

    expect(await signIn(`oidc-${T}`, { sub: "s-evil", email: "root@provider.example", email_verified: true })).toBe("/login?error=OidcLinkRefused")

    const sa = await prismaTest.user.findUniqueOrThrow({ where: { id: "u-sa" } })
    expect(sa).toMatchObject({ oidcSub: null, oidcConnectionId: null, authProvider: "credentials", password: "local-hash" })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      details: { reason: "email_in_use", provider: "oidc", connection: T },
    }))
  })

  it("is refused for a local account of the same tenant and of another tenant", async () => {
    await connection(T)
    await account("u-local", "local@acme.example", { tenantId: T })
    await account("u-other", "someone@other.example", { tenantId: OTHER })

    expect(await signIn(`oidc-${T}`, { sub: "s-1", email: "local@acme.example", email_verified: true })).toBe("/login?error=OidcLinkRefused")
    expect(await signIn(`oidc-${T}`, { sub: "s-2", email: "someone@other.example", email_verified: true })).toBe("/login?error=OidcLinkRefused")
    expect(await prismaTest.user.count({ where: { oidcSub: { not: null } } })).toBe(0)
  })
})

describe("identities are (connection, subject)", () => {
  it("signs a returning tenant user into the same account", async () => {
    await connection(T)
    await signIn(`oidc-${T}`, { sub: "s-alice", email: "alice@acme.example" })
    expect(await signIn(`oidc-${T}`, { sub: "s-alice", email: "alice@acme.example" })).toBe(true)
    expect(await prismaTest.user.count()).toBe(1)
  })

  it("does not let the provider IdP reuse a tenant user's subject", async () => {
    await connection(T)
    await connection("default", { defaultRole: "viewer" })
    await signIn(`oidc-${T}`, { sub: "s-shared", email: "alice@acme.example" })
    const alice = await prismaTest.user.findUniqueOrThrow({ where: { email: "alice@acme.example" } })

    const user = { id: "s-shared" } as Record<string, unknown>
    await (authOptions.callbacks as any).signIn({
      user,
      account: { provider: "oidc" },
      profile: { sub: "s-shared", email: "staff@provider.example", email_verified: true },
    })

    expect(user.id).not.toBe(alice.id)
    expect(await prismaTest.user.findUniqueOrThrow({ where: { id: alice.id } })).toMatchObject({ email: "alice@acme.example", oidcConnectionId: T })
    expect(await prismaTest.user.findUniqueOrThrow({ where: { email: "staff@provider.example" } })).toMatchObject({ oidcConnectionId: "default", oidcSub: "s-shared" })
  })

  it("does not let a tenant IdP reuse the subject of the provider IdP", async () => {
    await connection(T)
    await account("u-staff", "staff@provider.example", { authProvider: "oidc", oidcSub: "s-shared", oidcConnectionId: "default" })

    expect(await signIn(`oidc-${T}`, { sub: "s-shared", email: "new@acme.example" })).toBe(true)
    const created = await prismaTest.user.findUniqueOrThrow({ where: { email: "new@acme.example" } })
    expect(created.id).not.toBe("u-staff")
  })
})

describe("provider accounts written without a connection id", () => {
  // A configuration backup taken before issue #1289, or an instance still on
  // the previous version during an HA rolling upgrade, writes oidc_sub without
  // oidc_connection_id. Those are provider identities.
  it("still sign in through the provider IdP, and get the connection stamped", async () => {
    await connection("default", { defaultRole: "viewer" })
    await account("u-legacy", "legacy@provider.example", { tenantId: "default", authProvider: "oidc", oidcSub: "s-legacy", oidcConnectionId: null, password: null })
    await prismaTest.userTenant.create({ data: { userId: "u-legacy", tenantId: "default", isDefault: true, joinedAt: now } })

    const user = { id: "s-legacy" } as Record<string, unknown>
    const accepted = await (authOptions.callbacks as any).signIn({
      user, account: { provider: "oidc" }, profile: { sub: "s-legacy", email: "legacy@provider.example", email_verified: true },
    })

    expect(accepted).toBe(true)
    expect(user.id).toBe("u-legacy")
    expect(await prismaTest.user.findUniqueOrThrow({ where: { id: "u-legacy" } })).toMatchObject({ oidcConnectionId: "default" })
  })

  it("is never reached by a tenant IdP sending the same subject", async () => {
    await connection(T)
    await account("u-legacy", "legacy@provider.example", { tenantId: "default", authProvider: "oidc", oidcSub: "s-legacy", oidcConnectionId: null })
    expect(await signIn(`oidc-${T}`, { sub: "s-legacy", email: "other@acme.example" })).toBe(true)
    expect((await prismaTest.user.findUniqueOrThrow({ where: { email: "other@acme.example" } })).id).not.toBe("u-legacy")
  })

  it("refuses the provider IdP the same sub and e-mail as a tenant account (Review Focus 1)", async () => {
    await connection(T)
    await connection("default", { defaultRole: "viewer" })
    await signIn(`oidc-${T}`, { sub: "s-dup", email: "dup@acme.example" })
    const result = await (authOptions.callbacks as any).signIn({
      user: { id: "s-dup" }, account: { provider: "oidc" }, profile: { sub: "s-dup", email: "dup@acme.example", email_verified: true },
    })
    expect(result).toBe("/login?error=OidcLinkRefused")
    expect(await prismaTest.user.findUniqueOrThrow({ where: { email: "dup@acme.example" } })).toMatchObject({ oidcConnectionId: T })
  })
})

describe("connections that cannot sign anyone in", () => {
  it("refuses a connection whose tenant is disabled", async () => {
    await connection(T)
    await tenant(T, false)
    expect(await signIn(`oidc-${T}`, { sub: "s-a", email: "a@acme.example" })).toBe(false)
    expect(await prismaTest.user.count()).toBe(0)
  })

  it("refuses a disabled or unknown connection", async () => {
    await connection(T, { enabled: false })
    expect(await signIn(`oidc-${T}`, { sub: "s-a", email: "a@acme.example" })).toBe(false)
    expect(await signIn("oidc-t-ghost", { sub: "s-a", email: "a@acme.example" })).toBe(false)
  })

  it("refuses a disabled account bound to the connection", async () => {
    await connection(T)
    await account("u-off", "off@acme.example", { tenantId: T, authProvider: "oidc", oidcSub: "s-off", oidcConnectionId: T, enabled: false })
    expect(await signIn(`oidc-${T}`, { sub: "s-off", email: "off@acme.example" })).toBe(false)
  })
})
