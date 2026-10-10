import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    userTenant: { findFirst: vi.fn(), upsert: vi.fn() },
    rbacUserRole: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}))
vi.mock("@/lib/auth/verify-second-factor", () => ({
  verifyTotpOrRecovery: vi.fn(),
}))
vi.mock("./ldap", () => ({
  isLdapEnabled: vi.fn().mockResolvedValue(true),
  authenticateLdapDetailed: vi.fn(),
  getLdapConfig: vi.fn().mockResolvedValue(null),
  resolveLdapRole: vi.fn(),
  syncLdapRoleAssignment: vi.fn(),
}))
vi.mock("./loginLockout", () => ({ beginLoginAttempt: vi.fn() }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

import { prisma } from "@/lib/db/prisma"
import { verifyPassword } from "@/lib/auth/password"
import { verifyTotpOrRecovery } from "@/lib/auth/verify-second-factor"
import { authenticateLdapDetailed } from "./ldap"
import { beginLoginAttempt } from "./loginLockout"
import { authOptions } from "./config"

function authorizeOf(id: string) {
  // CredentialsProvider keeps the custom id in `options`; the top-level id stays "credentials".
  const p = (authOptions.providers as any[]).find((p) => (p.options?.id ?? p.id) === id)
  return p.options.authorize.bind(p.options)
}

const REQ = { headers: { "x-forwarded-for": "203.0.113.5" } }
const fail = vi.fn()
const succeed = vi.fn()

function lockoutReturns(locked: boolean) {
  ;(beginLoginAttempt as any).mockResolvedValue({ locked, fail, succeed })
}

const LOCAL_USER = {
  id: "u1", email: "a@b.com", password: "h", name: null, avatar: null,
  enabled: true, role: "viewer", totpEnabled: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  lockoutReturns(false)
  ;(prisma.userTenant.findFirst as any).mockResolvedValue({ userId: "u1" })
})

describe("credentials authorize with the lockout policy", () => {
  it("refuses a locked account with the wrong-password message, without checking the password", async () => {
    lockoutReturns(true)
    ;(prisma.user.findUnique as any).mockResolvedValue(LOCAL_USER)
    ;(verifyPassword as any).mockResolvedValue(true)

    await expect(authorizeOf("credentials")({ email: "A@b.com", password: "right" }, REQ)).rejects.toThrow(
      /^Identifiants invalides$/,
    )
    expect(beginLoginAttempt).toHaveBeenCalledWith("a@b.com", REQ, "credentials")
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  it("counts a wrong password", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(LOCAL_USER)
    ;(verifyPassword as any).mockResolvedValue(false)

    await expect(authorizeOf("credentials")({ email: "a@b.com", password: "bad" }, REQ)).rejects.toThrow(
      /^Identifiants invalides$/,
    )
    expect(fail).toHaveBeenCalledExactlyOnceWith(true)
    expect(succeed).not.toHaveBeenCalled()
  })

  it("counts an unknown account against the IP only, with the same message as a wrong password", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(null)

    await expect(authorizeOf("credentials")({ email: "nobody@b.com", password: "x" }, REQ)).rejects.toThrow(
      /^Identifiants invalides$/,
    )
    expect(fail).toHaveBeenCalledExactlyOnceWith(false)
  })

  it("counts an account without a local password against the IP only", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...LOCAL_USER, password: null })

    await expect(authorizeOf("credentials")({ email: "a@b.com", password: "x" }, REQ)).rejects.toThrow()
    expect(fail).toHaveBeenCalledExactlyOnceWith(false)
  })

  it("counts a wrong second factor (2FA is checked inside the same authorize)", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...LOCAL_USER, totpEnabled: true })
    ;(verifyPassword as any).mockResolvedValue(true)
    ;(verifyTotpOrRecovery as any).mockResolvedValue(false)

    await expect(
      authorizeOf("credentials")({ email: "a@b.com", password: "right", totpCode: "000000" }, REQ),
    ).rejects.toThrow(/Identifiants invalides/)
    expect(fail).toHaveBeenCalledExactlyOnceWith(true)
  })

  it("does not count the TOTP_REQUIRED step, nor reset the counter on it", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...LOCAL_USER, totpEnabled: true })
    ;(verifyPassword as any).mockResolvedValue(true)

    await expect(authorizeOf("credentials")({ email: "a@b.com", password: "right" }, REQ)).rejects.toThrow(
      "TOTP_REQUIRED",
    )
    expect(fail).not.toHaveBeenCalled()
    expect(succeed).not.toHaveBeenCalled()
  })

  it("does not count a refusal that happens after a correct password (no tenant)", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(LOCAL_USER)
    ;(verifyPassword as any).mockResolvedValue(true)
    ;(prisma.userTenant.findFirst as any).mockResolvedValue(null)
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)

    await expect(authorizeOf("credentials")({ email: "a@b.com", password: "right" }, REQ)).rejects.toThrow()
    expect(fail).not.toHaveBeenCalled()
  })

  it("resets the account counter on success", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(LOCAL_USER)
    ;(verifyPassword as any).mockResolvedValue(true)

    const user = await authorizeOf("credentials")({ email: "a@b.com", password: "right" }, REQ)
    expect(user.id).toBe("u1")
    expect(succeed).toHaveBeenCalledTimes(1)
    expect(fail).not.toHaveBeenCalled()
  })
})

describe("LDAP authorize with the lockout policy", () => {
  it("refuses a locked account before binding to the directory", async () => {
    lockoutReturns(true)

    await expect(authorizeOf("ldap")({ username: "jdoe", password: "right" }, REQ)).rejects.toThrow(
      /^Identifiants LDAP invalides$/,
    )
    expect(beginLoginAttempt).toHaveBeenCalledWith("jdoe", REQ, "ldap")
    expect(authenticateLdapDetailed).not.toHaveBeenCalled()
  })

  it("counts a refused bind against the account", async () => {
    ;(authenticateLdapDetailed as any).mockResolvedValue({ user: null, failure: "invalid_password" })

    await expect(authorizeOf("ldap")({ username: "jdoe", password: "bad" }, REQ)).rejects.toThrow(
      /^Identifiants LDAP invalides$/,
    )
    expect(fail).toHaveBeenCalledExactlyOnceWith(true)
  })

  it("counts a user the directory does not know against the IP only, same message", async () => {
    ;(authenticateLdapDetailed as any).mockResolvedValue({ user: null, failure: "user_not_found" })

    await expect(authorizeOf("ldap")({ username: "ghost", password: "x" }, REQ)).rejects.toThrow(
      /^Identifiants LDAP invalides$/,
    )
    expect(fail).toHaveBeenCalledExactlyOnceWith(false)
  })

  it("does not count an LDAP or orchestrator error", async () => {
    ;(authenticateLdapDetailed as any).mockResolvedValue({ user: null, failure: "error" })

    await expect(authorizeOf("ldap")({ username: "jdoe", password: "x" }, REQ)).rejects.toThrow()
    expect(fail).not.toHaveBeenCalled()
  })

  it("counts a wrong second factor", async () => {
    ;(authenticateLdapDetailed as any).mockResolvedValue({
      user: { email: "j@d.io", name: "J", avatar: null, dn: "cn=j", groups: [] },
      failure: null,
    })
    ;(prisma.user.findUnique as any)
      .mockResolvedValueOnce({ id: "u2", email: "j@d.io", name: "J", role: "viewer", enabled: true })
      .mockResolvedValueOnce({ totpEnabled: true })
    ;(verifyTotpOrRecovery as any).mockResolvedValue(false)

    await expect(
      authorizeOf("ldap")({ username: "jdoe", password: "right", totpCode: "000000" }, REQ),
    ).rejects.toThrow(/Identifiants LDAP invalides/)
    expect(fail).toHaveBeenCalledTimes(1)
    expect(succeed).not.toHaveBeenCalled()
  })

  it("resets the account counter on success", async () => {
    ;(authenticateLdapDetailed as any).mockResolvedValue({
      user: { email: "j@d.io", name: "J", avatar: null, dn: "cn=j", groups: [] },
      failure: null,
    })
    ;(prisma.user.findUnique as any)
      .mockResolvedValueOnce({ id: "u2", email: "j@d.io", name: "J", role: "viewer", enabled: true })
      .mockResolvedValueOnce({ totpEnabled: false })

    const user = await authorizeOf("ldap")({ username: "jdoe", password: "right" }, REQ)
    expect(user.id).toBe("u2")
    expect(succeed).toHaveBeenCalledTimes(1)
    expect(fail).not.toHaveBeenCalled()
  })
})
