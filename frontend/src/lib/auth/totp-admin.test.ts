import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Module-level mocks ────────────────────────────────────────────────────

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    rbacUserRole: { findFirst: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))
vi.mock("./recovery", () => ({ hashRecoveryCode: vi.fn() }))
vi.mock("./password", () => ({ verifyPassword: vi.fn() }))
vi.mock("./totp", () => ({ verifyTotp: vi.fn() }))

// ─── Imports after mocks ───────────────────────────────────────────────────

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { hashRecoveryCode } from "./recovery"
import { verifyPassword } from "./password"
import { verifyTotp } from "./totp"

import {
  requireSuperAdminCaller,
  clearUserTotp,
  replaceRecoveryCodes,
  verifyReauthCredentials,
  setUserRequire2faFlag,
} from "./totp-admin"

// ─── requireSuperAdminCaller ───────────────────────────────────────────────

describe("requireSuperAdminCaller", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when no session", async () => {
    ;(getServerSession as any).mockResolvedValue(null)
    const res = await requireSuperAdminCaller()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    const body = await res!.json()
    expect(body.error).toBe("Unauthorized")
  })

  it("returns 401 when session has no user id", async () => {
    ;(getServerSession as any).mockResolvedValue({ user: {} })
    const res = await requireSuperAdminCaller()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
  })

  it("returns 403 when user is not super_admin", async () => {
    ;(getServerSession as any).mockResolvedValue({ user: { id: "u1" } })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)
    const res = await requireSuperAdminCaller()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    const body = await res!.json()
    expect(body.error).toBe("Forbidden")
  })

  it("returns null when user is super_admin", async () => {
    ;(getServerSession as any).mockResolvedValue({ user: { id: "u1" } })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue({ id: "r1" })
    const res = await requireSuperAdminCaller()
    expect(res).toBeNull()
  })
})

// ─── clearUserTotp ─────────────────────────────────────────────────────────

describe("clearUserTotp", () => {
  it("calls user.update and deleteMany with correct arguments", async () => {
    const userUpdate = vi.fn().mockResolvedValue({})
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const tx = {
      user: { update: userUpdate },
      userTotpRecoveryCode: { deleteMany },
    } as any

    await clearUserTotp(tx, "user-42")

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-42" },
      data: {
        totpSecretEnc: null,
        totpEnabled: false,
        totpEnrolledAt: null,
        totpLastUsedStep: null,
      },
    })
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "user-42" } })
  })
})

// ─── replaceRecoveryCodes ──────────────────────────────────────────────────

describe("replaceRecoveryCodes", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls deleteMany then createMany with hashed codes and provided timestamp", async () => {
    const deleteMany = vi.fn().mockResolvedValue({})
    const createMany = vi.fn().mockResolvedValue({})
    const tx = {
      userTotpRecoveryCode: { deleteMany, createMany },
    } as any

    ;(hashRecoveryCode as any)
      .mockResolvedValueOnce("hash1")
      .mockResolvedValueOnce("hash2")

    const now = new Date("2024-01-15T10:00:00Z")
    await replaceRecoveryCodes(tx, "user-99", ["CODE1", "CODE2"], now)

    expect(deleteMany).toHaveBeenCalledTimes(1)
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "user-99" } })

    expect(createMany).toHaveBeenCalledTimes(1)
    const createManyCall = (createMany as any).mock.calls[0][0]
    expect(createManyCall.data).toHaveLength(2)
    expect(createManyCall.data[0]).toMatchObject({ userId: "user-99", codeHash: "hash1", createdAt: now })
    expect(createManyCall.data[1]).toMatchObject({ userId: "user-99", codeHash: "hash2", createdAt: now })
  })

  it("hashes all N codes (10 by default)", async () => {
    const deleteMany = vi.fn().mockResolvedValue({})
    const createMany = vi.fn().mockResolvedValue({})
    const tx = { userTotpRecoveryCode: { deleteMany, createMany } } as any

    const codes = Array.from({ length: 10 }, (_, i) => `CODE${i}`)
    ;(hashRecoveryCode as any).mockResolvedValue("anyhash")

    await replaceRecoveryCodes(tx, "uid", codes)

    expect(hashRecoveryCode).toHaveBeenCalledTimes(10)
    expect(createMany.mock.calls[0][0].data).toHaveLength(10)
  })
})

// ─── verifyReauthCredentials ───────────────────────────────────────────────

describe("verifyReauthCredentials", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns true when password is valid", async () => {
    ;(verifyPassword as any).mockResolvedValue(true)
    ;(verifyTotp as any).mockResolvedValue(false)
    const ok = await verifyReauthCredentials("u1", "hashedpw", { password: "correctpw" })
    expect(ok).toBe(true)
    expect(verifyPassword).toHaveBeenCalledWith("correctpw", "hashedpw")
  })

  it("returns true when totp code is valid", async () => {
    ;(verifyPassword as any).mockResolvedValue(false)
    ;(verifyTotp as any).mockResolvedValue(true)
    const ok = await verifyReauthCredentials("u1", "hashedpw", { totpCode: "123456" })
    expect(ok).toBe(true)
    expect(verifyTotp).toHaveBeenCalledWith("u1", "123456")
  })

  it("returns false when both password and totp are invalid", async () => {
    ;(verifyPassword as any).mockResolvedValue(false)
    ;(verifyTotp as any).mockResolvedValue(false)
    const ok = await verifyReauthCredentials("u1", "hashedpw", { password: "wrong", totpCode: "000000" })
    expect(ok).toBe(false)
  })

  it("returns false without crashing when passwordHash is null and totp code is invalid", async () => {
    ;(verifyTotp as any).mockResolvedValue(false)
    const ok = await verifyReauthCredentials("u1", null, { totpCode: "badcode" })
    expect(ok).toBe(false)
    // verifyPassword should NOT be called when hash is null
    expect(verifyPassword).not.toHaveBeenCalled()
  })
})

// ─── setUserRequire2faFlag ─────────────────────────────────────────────────

describe("setUserRequire2faFlag", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 404 when target user not found", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    const res = await setUserRequire2faFlag("missing-id", true, { id: "actor-1" })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("User not found")
  })

  it("updates flag to true and emits 2fa_required_for_user audit", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ email: "target@example.com" })
    ;(prisma.user.update as any).mockResolvedValue({})
    ;(audit as any).mockResolvedValue(undefined)

    const res = await setUserRequire2faFlag("target-id", true, { id: "actor-1", email: "actor@example.com" })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.ok).toBe(true)

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "target-id" },
      data: { require2faEnrollment: true },
    })

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "2fa_required_for_user",
        category: "auth",
        userId: "actor-1",
        userEmail: "actor@example.com",
        resourceType: "user",
        resourceId: "target-id",
        resourceName: "target@example.com",
        status: "success",
      }),
    )
  })

  it("updates flag to false and emits 2fa_requirement_cleared audit", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ email: "target@example.com" })
    ;(prisma.user.update as any).mockResolvedValue({})
    ;(audit as any).mockResolvedValue(undefined)

    const res = await setUserRequire2faFlag("target-id", false, { id: "actor-1" })

    expect(res.status).toBe(200)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "2fa_requirement_cleared" }),
    )
  })
})
