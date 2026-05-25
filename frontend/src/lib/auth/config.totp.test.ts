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
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

import { prisma } from "@/lib/db/prisma"
import { verifyTotpOrRecovery } from "@/lib/auth/verify-second-factor"
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
    ).rejects.toThrow(/Identifiants invalides/)
  })
})
