import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    securityPolicy: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
}))

import { prisma } from "@/lib/db/prisma"
import { updateSecurityPolicies } from "./policies"

const mockGetReturn = {
  id: "default",
  tenantId: "default",
  passwordMinLength: 8,
  passwordRequireUppercase: false,
  passwordRequireLowercase: false,
  passwordRequireNumbers: false,
  passwordRequireSpecial: false,
  sessionTimeoutMinutes: 43200,
  sessionMaxConcurrent: 0,
  loginMaxFailedAttempts: 0,
  loginLockoutDurationMinutes: 15,
  auditRetentionDays: 90,
  auditAutoCleanup: false,
  require2faForSuperAdmin: false,
  updatedAt: new Date(),
  updatedBy: null,
}

describe("updateSecurityPolicies foot-shoot guard", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects enabling require_2fa_for_super_admin when actor lacks 2FA", async () => {
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue(mockGetReturn)
    ;(prisma.user.findUnique as any).mockResolvedValue({ totpEnabled: false })

    await expect(
      updateSecurityPolicies({ require_2fa_for_super_admin: true }, "actor1"),
    ).rejects.toThrow(/E_NEED_OWN_2FA/)
  })

  it("allows the flip when actor has 2FA enrolled", async () => {
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue(mockGetReturn)
    ;(prisma.user.findUnique as any).mockResolvedValue({ totpEnabled: true })
    ;(prisma.securityPolicy.updateMany as any).mockResolvedValue({ count: 1 })

    await updateSecurityPolicies({ require_2fa_for_super_admin: true }, "actor1")

    expect(prisma.securityPolicy.updateMany).toHaveBeenCalled()
  })

  it("ignores the guard on disabling transitions", async () => {
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({
      ...mockGetReturn,
      require2faForSuperAdmin: true,
    })
    ;(prisma.securityPolicy.updateMany as any).mockResolvedValue({ count: 1 })

    await updateSecurityPolicies({ require_2fa_for_super_admin: false }, "actor1")

    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.securityPolicy.updateMany).toHaveBeenCalled()
  })

  it("ignores the guard when policy already on (no transition)", async () => {
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({
      ...mockGetReturn,
      require2faForSuperAdmin: true,
    })
    ;(prisma.securityPolicy.updateMany as any).mockResolvedValue({ count: 1 })

    await updateSecurityPolicies({ require_2fa_for_super_admin: true }, "actor1")

    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
