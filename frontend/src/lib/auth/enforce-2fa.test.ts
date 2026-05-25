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

  it("returns false when policy is off", async () => {
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ require2faForSuperAdmin: false })
    expect(await needsEnrollment("u1")).toBe(false)
  })

  it("returns false when policy on but user is not super_admin", async () => {
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ require2faForSuperAdmin: true })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)
    expect(await needsEnrollment("u1")).toBe(false)
  })

  it("returns true when policy on, user is super_admin, totp disabled", async () => {
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ require2faForSuperAdmin: true })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue({ id: "r1" })
    ;(prisma.user.findUnique as any).mockResolvedValue({ totpEnabled: false })
    expect(await needsEnrollment("u1")).toBe(true)
  })

  it("returns false once totp is enabled", async () => {
    ;(prisma.securityPolicy.findFirst as any).mockResolvedValue({ require2faForSuperAdmin: true })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue({ id: "r1" })
    ;(prisma.user.findUnique as any).mockResolvedValue({ totpEnabled: true })
    expect(await needsEnrollment("u1")).toBe(false)
  })
})
