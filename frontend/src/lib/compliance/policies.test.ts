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
import {
  AUDIT_RETENTION_MIN_DAYS,
  E_AUDIT_RETENTION_TOO_SHORT,
  effectiveAuditRetentionDays,
  getAuditRetentionPolicy,
  updateSecurityPolicies,
} from "./policies"

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
  loginIpMaxFailedAttempts: 0,
  loginTrustedProxies: 1,
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

describe("updateSecurityPolicies audit retention floor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue(mockGetReturn)
    ;(prisma.securityPolicy.updateMany as any).mockResolvedValue({ count: 1 })
  })

  it.each([29, 30.5, -1, Number.NaN, "45", null])("refuses %s before touching the row", async (value) => {
    await expect(
      updateSecurityPolicies({ audit_retention_days: value }, "actor1"),
    ).rejects.toThrow(E_AUDIT_RETENTION_TOO_SHORT)
    expect(prisma.securityPolicy.updateMany).not.toHaveBeenCalled()
  })

  it("accepts the floor itself and writes it", async () => {
    await updateSecurityPolicies({ audit_retention_days: AUDIT_RETENTION_MIN_DAYS }, "actor1")

    expect(prisma.securityPolicy.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ auditRetentionDays: AUDIT_RETENTION_MIN_DAYS }) }),
    )
  })

  it("does not look at a payload that leaves the retention alone", async () => {
    await updateSecurityPolicies({ audit_auto_cleanup: true }, "actor1")

    expect(prisma.securityPolicy.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ auditAutoCleanup: true }) }),
    )
  })
})

describe("getAuditRetentionPolicy", () => {
  beforeEach(() => vi.clearAllMocks())

  it("reads the switch and clamps the days to the floor", async () => {
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ auditAutoCleanup: true, auditRetentionDays: 1 })
    expect(await getAuditRetentionPolicy()).toEqual({ autoCleanup: true, retentionDays: AUDIT_RETENTION_MIN_DAYS })

    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ auditAutoCleanup: true, auditRetentionDays: 365 })
    expect(await getAuditRetentionPolicy()).toEqual({ autoCleanup: true, retentionDays: 365 })
  })

  it("reads a missing row as cleanup off", async () => {
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue(null)
    expect(await getAuditRetentionPolicy()).toEqual({ autoCleanup: false, retentionDays: 90 })
  })
})

describe("effectiveAuditRetentionDays", () => {
  it("floors at the minimum and truncates fractions", () => {
    expect(effectiveAuditRetentionDays(1)).toBe(AUDIT_RETENTION_MIN_DAYS)
    expect(effectiveAuditRetentionDays(AUDIT_RETENTION_MIN_DAYS)).toBe(AUDIT_RETENTION_MIN_DAYS)
    expect(effectiveAuditRetentionDays(45.9)).toBe(45)
  })
})
