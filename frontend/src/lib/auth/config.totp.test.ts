import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    userTenant: { findFirst: vi.fn().mockResolvedValue({ userId: "u1" }), upsert: vi.fn() },
    rbacUserRole: { findFirst: vi.fn() },
    securityPolicy: { findFirst: vi.fn().mockResolvedValue({ require2faForSuperAdmin: false }) },
  },
}))
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn().mockResolvedValue(true),
  hashPassword: vi.fn(),
}))
vi.mock("@/lib/auth/verify-second-factor", () => ({
  verifyTotpOrRecovery: vi.fn(),
}))
// Pass-through by default: the floor itself is proven in totpThrottle.db.test.ts.
vi.mock("./totpThrottle", () => ({
  withTotpThrottle: vi.fn(async (_userId: string, _context: string, verify: () => Promise<boolean>) =>
    (await verify()) ? "ok" : "invalid"),
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { verifyTotpOrRecovery } from "@/lib/auth/verify-second-factor"
import { withTotpThrottle } from "./totpThrottle"
import { authOptions } from "./config"

function credsAuthorize() {
  const p = (authOptions.providers as any[]).find((p) => p.id === "credentials")
  return p.options.authorize.bind(p.options)
}

describe("credentials authorize step-up", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws TOTP_REQUIRED when password OK but totpCode missing", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      id: "u1", email: "a@b.com", password: "h",
      enabled: true, role: "viewer", totpEnabled: true,
    })
    await expect(
      credsAuthorize()({ email: "a@b.com", password: "p" }),
    ).rejects.toThrow("TOTP_REQUIRED")
  })

  it("returns the user when totpCode is valid", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      id: "u1", email: "a@b.com", password: "h",
      enabled: true, role: "viewer", totpEnabled: true,
    })
    ;(verifyTotpOrRecovery as any).mockResolvedValue(true)
    const user = await credsAuthorize()({
      email: "a@b.com", password: "p", totpCode: "123456",
    })
    expect(user.id).toBe("u1")
  })

  it("throws generic invalid creds on bad totp (no oracle)", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      id: "u1", email: "a@b.com", password: "h",
      enabled: true, role: "viewer", totpEnabled: true,
    })
    ;(verifyTotpOrRecovery as any).mockResolvedValue(false)
    await expect(
      credsAuthorize()({
        email: "a@b.com", password: "p", totpCode: "000000",
      }),
    ).rejects.toThrow(/Invalid credentials/)
  })

  it("runs the second factor under the always-on floor, keyed by the user id", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      id: "u1", email: "a@b.com", password: "h",
      enabled: true, role: "viewer", totpEnabled: true,
    })
    ;(verifyTotpOrRecovery as any).mockResolvedValue(true)
    await credsAuthorize()({ email: "a@b.com", password: "p", totpCode: "123456" })
    expect(withTotpThrottle).toHaveBeenCalledWith("u1", "login", expect.any(Function))
  })

  it("throttled: same generic error as a wrong code, audited as a throttled login failure", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      id: "u1", email: "a@b.com", password: "h",
      enabled: true, role: "viewer", totpEnabled: true,
    })
    ;(withTotpThrottle as any).mockResolvedValueOnce("throttled")
    await expect(
      credsAuthorize()({ email: "a@b.com", password: "p", totpCode: "123456" }),
    ).rejects.toThrow(/^Invalid credentials$/)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "login_failed",
      userEmail: "a@b.com",
      details: { reason: "2FA throttled", provider: "credentials" },
    }))
  })
})
