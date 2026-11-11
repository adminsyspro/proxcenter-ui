/**
 * An account a tenant's own IdP created is that IdP's (issue #1289). The LDAP
 * sign-in finds accounts by e-mail: it must not bind the provider's directory
 * to such an account, or a tenant that provisioned the address of a future
 * provider employee would sign into that employee's provider roles later on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { prismaTest, truncate } from "../../__tests__/setup/prisma-test"

const { authenticateMock, auditMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  auditMock: vi.fn(async (_e: Record<string, unknown>) => "id"),
}))

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaTest }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
vi.mock("./ldap", () => ({
  isLdapEnabled: vi.fn().mockResolvedValue(true),
  authenticateLdapDetailed: authenticateMock,
  getLdapConfig: vi.fn().mockResolvedValue(null),
  resolveLdapRole: vi.fn().mockReturnValue("role_super_admin"),
  syncLdapRoleAssignment: vi.fn(),
}))
vi.mock("./loginLockout", () => ({
  beginLoginAttempt: vi.fn().mockResolvedValue({ locked: false, fail: vi.fn(), succeed: vi.fn() }),
}))

const { authOptions } = await import("./config")

function ldapAuthorize(username: string) {
  const p = (authOptions.providers as any[]).find(x => (x.options?.id ?? x.id) === "ldap")
  return p.options.authorize.call(p.options, { username, password: "pw" }, { headers: {} })
}

const T = "t-acme"
const now = new Date()

beforeEach(async () => {
  vi.clearAllMocks()
  await truncate(["user_tenants", "users"])
  await prismaTest.tenant.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", slug: "default", name: "Default", createdAt: now, updatedAt: now },
  })
  await prismaTest.tenant.upsert({
    where: { id: T },
    update: {},
    create: { id: T, slug: "acme", name: "Acme", operatingModel: "msp", createdAt: now, updatedAt: now },
  })
  authenticateMock.mockResolvedValue({
    user: { email: "new.admin@provider.example", name: "New Admin", dn: "uid=new.admin,dc=provider", groups: ["admins"], avatar: null },
  })
})

describe("LDAP sign-in and accounts of a tenant IdP", () => {
  it("refuses to bind the directory to an account a tenant IdP provisioned", async () => {
    await prismaTest.user.create({
      data: {
        id: "u-squat", tenantId: T, email: "new.admin@provider.example", authProvider: "oidc",
        oidcSub: "tenant-sub", oidcConnectionId: T, createdAt: now, updatedAt: now,
      },
    })

    await expect(ldapAuthorize("new.admin")).rejects.toThrow()

    const row = await prismaTest.user.findUniqueOrThrow({ where: { id: "u-squat" } })
    expect(row).toMatchObject({ authProvider: "oidc", ldapDn: null, oidcConnectionId: T })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "login_failed",
      details: expect.objectContaining({ reason: "tenant_idp_account" }),
    }))
  })

  it("still binds an account of the provider's own IdP, as before", async () => {
    await prismaTest.user.create({
      data: {
        id: "u-staff", tenantId: "default", email: "new.admin@provider.example", authProvider: "oidc",
        oidcSub: "provider-sub", oidcConnectionId: "default", createdAt: now, updatedAt: now,
      },
    })
    await prismaTest.userTenant.create({ data: { userId: "u-staff", tenantId: "default", isDefault: true, joinedAt: now } })

    const user = await ldapAuthorize("new.admin")
    expect(user).toMatchObject({ id: "u-staff" })
    expect(await prismaTest.user.findUniqueOrThrow({ where: { id: "u-staff" } })).toMatchObject({ authProvider: "ldap" })
  })
})
