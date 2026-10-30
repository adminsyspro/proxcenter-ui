import { describe, it, expect, vi, beforeEach } from "vitest"

const { getOidcConfigMock } = vi.hoisted(() => ({ getOidcConfigMock: vi.fn() }))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    userTenant: { findFirst: vi.fn(), upsert: vi.fn() },
    rbacUserRole: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  needsRehash: vi.fn().mockReturnValue(false),
  burnPasswordCheck: vi.fn(),
}))
vi.mock("./ldap", () => ({
  isLdapEnabled: vi.fn().mockResolvedValue(true),
  authenticateLdapDetailed: vi.fn(),
  getLdapConfig: vi.fn().mockResolvedValue(null),
  resolveLdapRole: vi.fn(),
  syncLdapRoleAssignment: vi.fn(),
}))
vi.mock("./oidc", () => ({
  getOidcConfig: getOidcConfigMock,
  isOidcEnabled: async () => false,
  oidcSeedRoleId: vi.fn(),
  syncOidcRoleAssignment: vi.fn(),
}))
vi.mock("./loginLockout", () => ({ beginLoginAttempt: vi.fn() }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

import { prisma } from "@/lib/db/prisma"
import { authenticateLdapDetailed, isLdapEnabled } from "./ldap"
import { beginLoginAttempt } from "./loginLockout"
import { authOptions } from "./config"

function authorizeOf(id: string) {
  const p = (authOptions.providers as any[]).find((p) => (p.options?.id ?? p.id) === id)
  return p.options.authorize.bind(p.options)
}

const REQ = { headers: { "x-forwarded-for": "203.0.113.5" } }
const LDAP_USER = { email: "j@d.io", name: "J", avatar: null, dn: "cn=j", groups: [] }

beforeEach(() => {
  vi.clearAllMocks()
  ;(beginLoginAttempt as any).mockResolvedValue({ locked: false, fail: vi.fn(), succeed: vi.fn() })
  ;(isLdapEnabled as any).mockResolvedValue(true)
})

describe("credentials authorize English messages", () => {
  it("requires an email and a password", async () => {
    await expect(authorizeOf("credentials")({ email: "", password: "" }, REQ)).rejects.toThrow(
      /^Email and password are required$/,
    )
  })

  it("refuses a disabled account", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ id: "u1", email: "a@b.com", password: "h", enabled: false })
    await expect(authorizeOf("credentials")({ email: "a@b.com", password: "x" }, REQ)).rejects.toThrow(
      /^Account disabled$/,
    )
  })

  it("refuses an account without a local password", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ id: "u1", email: "a@b.com", password: null, enabled: true })
    await expect(authorizeOf("credentials")({ email: "a@b.com", password: "x" }, REQ)).rejects.toThrow(
      /^This account uses another authentication method$/,
    )
  })
})

describe("LDAP authorize English messages", () => {
  it("requires a username and a password", async () => {
    await expect(authorizeOf("ldap")({ username: "", password: "" }, REQ)).rejects.toThrow(
      /^Username and password are required$/,
    )
  })

  it("refuses when LDAP is not configured", async () => {
    ;(isLdapEnabled as any).mockResolvedValue(false)
    await expect(authorizeOf("ldap")({ username: "jdoe", password: "x" }, REQ)).rejects.toThrow(
      /^LDAP authentication is not configured$/,
    )
  })

  it("refuses a disabled local account", async () => {
    ;(authenticateLdapDetailed as any).mockResolvedValue({ user: LDAP_USER, failure: null })
    ;(prisma.user.findUnique as any).mockResolvedValue({ id: "u2", email: "j@d.io", name: "J", role: "viewer", enabled: false })
    await expect(authorizeOf("ldap")({ username: "jdoe", password: "x" }, REQ)).rejects.toThrow(/^Account disabled$/)
  })

  it("refuses an account with no tenant", async () => {
    ;(authenticateLdapDetailed as any).mockResolvedValue({ user: LDAP_USER, failure: null })
    ;(prisma.user.findUnique as any).mockResolvedValue({ id: "u2", email: "j@d.io", name: "J", role: "viewer", enabled: true })
    ;(prisma.userTenant.findFirst as any).mockResolvedValue(null)
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)
    await expect(authorizeOf("ldap")({ username: "jdoe", password: "x" }, REQ)).rejects.toThrow(
      /^Account has no tenant, contact your administrator$/,
    )
  })
})

describe("OIDC signIn English messages", () => {
  it("refuses an existing account with no tenant", async () => {
    getOidcConfigMock.mockResolvedValue({ enabled: true, claimEmail: "email", claimName: "name", claimGroups: "groups" })
    ;(prisma.user.findFirst as any).mockResolvedValue({ id: "u3", email: "o@d.io", name: "O", role: "viewer", enabled: true, oidcSub: "sub-1" })
    ;(prisma.userTenant.findFirst as any).mockResolvedValue(null)
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)

    await expect(
      (authOptions.callbacks as any).signIn({
        user: { id: "sub-1" },
        account: { provider: "oidc" },
        profile: { sub: "sub-1", email: "o@d.io", name: "O" },
      }),
    ).rejects.toThrow(/^Account has no tenant, contact your administrator$/)
  })
})
