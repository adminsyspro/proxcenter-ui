import { describe, expect, it, vi, beforeEach } from "vitest"
import { needsEnrollment } from "./enforce-2fa"

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    securityPolicy: { findFirst: vi.fn() },
    rbacUserRole: { findFirst: vi.fn() },
  },
}))

import { prisma } from "@/lib/db/prisma"

describe("needsEnrollment", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns false when policy is off and no per-user flag", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ totpEnabled: false, require2faEnrollment: false })
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ require2faForSuperAdmin: false })
    expect(await needsEnrollment("u1")).toBe(false)
  })

  it("returns false when policy on but user is not super_admin", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ totpEnabled: false, require2faEnrollment: false })
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ require2faForSuperAdmin: true })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)
    expect(await needsEnrollment("u1")).toBe(false)
  })

  it("returns true when policy on, user is super_admin, totp disabled", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ totpEnabled: false, require2faEnrollment: false })
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ require2faForSuperAdmin: true })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue({ id: "r1" })
    expect(await needsEnrollment("u1")).toBe(true)
  })

  it("returns false once totp is enabled (super_admin policy path)", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ totpEnabled: true, require2faEnrollment: false })
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ require2faForSuperAdmin: true })
    expect(await needsEnrollment("u1")).toBe(false)
  })

  it("returns true when require2faEnrollment flag is set and totp is disabled", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ totpEnabled: false, require2faEnrollment: true })
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ require2faForSuperAdmin: false })
    expect(await needsEnrollment("u1")).toBe(true)
  })

  it("returns false when require2faEnrollment flag is set but totp is already enabled", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ totpEnabled: true, require2faEnrollment: true })
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ require2faForSuperAdmin: false })
    expect(await needsEnrollment("u1")).toBe(false)
  })
})
