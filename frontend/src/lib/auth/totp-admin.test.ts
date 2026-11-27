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
vi.mock("./recovery", () => ({ hashRecoveryCode: vi.fn(), findUnusedRecoveryCode: vi.fn(), markRecoveryCodeConsumed: vi.fn(), RECOVERY_CODE_PATTERN: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/ }))
vi.mock("./password", () => ({ verifyPassword: vi.fn() }))
vi.mock("./totp", () => ({ verifyTotp: vi.fn() }))
vi.mock("./sessions", () => ({ revokeAllSessions: vi.fn() }))
// Pass-through by default: the floor itself is proven in totpThrottle.db.test.ts.
vi.mock("./totpThrottle", () => ({
  withTotpThrottle: vi.fn(async (_userId: string, _context: string, verify: () => Promise<boolean>) =>
    (await verify()) ? "ok" : "invalid"),
}))

// ─── Imports after mocks ───────────────────────────────────────────────────

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { findUnusedRecoveryCode, hashRecoveryCode, markRecoveryCodeConsumed } from "./recovery"
import { verifyPassword } from "./password"
import { verifyTotp } from "./totp"
import { withTotpThrottle } from "./totpThrottle"
import { revokeAllSessions } from "./sessions"

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

describe("verifyReauthCredentials (roadmap#280: password AND second factor)", () => {
  beforeEach(() => vi.clearAllMocks())

  const answers = (password: boolean, totp: boolean, recovery = false) => {
    ;(verifyPassword as any).mockResolvedValue(password)
    ;(verifyTotp as any).mockResolvedValue(totp)
    ;(findUnusedRecoveryCode as any).mockResolvedValue(recovery ? "code-1" : null)
    ;(markRecoveryCodeConsumed as any).mockResolvedValue(true)
  }

  it("accepts the password together with a current TOTP code", async () => {
    answers(true, true)
    expect(await verifyReauthCredentials("u1", "hashedpw", { password: "correctpw", totpCode: "123456" })).toBe(true)
    expect(verifyPassword).toHaveBeenCalledWith("correctpw", "hashedpw")
    expect(verifyTotp).toHaveBeenCalledWith("u1", "123456")
  })

  it("refuses the password alone", async () => {
    answers(true, false)
    expect(await verifyReauthCredentials("u1", "hashedpw", { password: "correctpw" })).toBe(false)
  })

  it("refuses a TOTP code alone when the account has a password", async () => {
    answers(false, true)
    expect(await verifyReauthCredentials("u1", "hashedpw", { totpCode: "123456" })).toBe(false)
  })

  it("refuses a wrong password and a wrong code", async () => {
    answers(false, false)
    expect(await verifyReauthCredentials("u1", "hashedpw", { password: "wrong", totpCode: "000000" })).toBe(false)
  })

  it("accepts the password with an unused recovery code, typed in any case", async () => {
    answers(true, false, true)
    expect(await verifyReauthCredentials("u1", "hashedpw", { password: "correctpw", totpCode: " y4gqt-8tt5q " })).toBe(true)
    expect(findUnusedRecoveryCode).toHaveBeenCalledWith("u1", "Y4GQT-8TT5Q")
    expect(markRecoveryCodeConsumed).toHaveBeenCalledWith("code-1", null)
    expect(verifyTotp).not.toHaveBeenCalled()
  })

  it("never spends a recovery code when the password is wrong, but still hashes it (no timing tell)", async () => {
    answers(false, false, true)
    expect(await verifyReauthCredentials("u1", "hashedpw", { password: "wrong", totpCode: "Y4GQT-8TT5Q" })).toBe(false)
    expect(findUnusedRecoveryCode).toHaveBeenCalledWith("u1", "Y4GQT-8TT5Q")
    expect(markRecoveryCodeConsumed).not.toHaveBeenCalled()
  })

  it("never burns the authenticator code when the password is wrong", async () => {
    answers(false, true)
    expect(await verifyReauthCredentials("u1", "hashedpw", { password: "wrong", totpCode: "123456" })).toBe(false)
    expect(verifyTotp).not.toHaveBeenCalled()
  })

  it("refuses a recovery code another request spent first", async () => {
    answers(true, false, true)
    ;(markRecoveryCodeConsumed as any).mockResolvedValue(false)
    expect(await verifyReauthCredentials("u1", "hashedpw", { password: "correctpw", totpCode: "Y4GQT-8TT5Q" })).toBe(false)
  })

  it("an account without a local password (SSO) proves itself with the code alone", async () => {
    answers(false, true)
    expect(await verifyReauthCredentials("u1", null, { totpCode: "123456" })).toBe(true)
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  it("an account without a local password still needs a valid code", async () => {
    answers(false, false)
    expect(await verifyReauthCredentials("u1", null, { totpCode: "badcode" })).toBe(false)
    expect(await verifyReauthCredentials("u1", null, {})).toBe(false)
  })

  it("runs under the always-on floor in the re-auth context", async () => {
    answers(true, true)
    expect(await verifyReauthCredentials("u1", "hashedpw", { password: "correctpw", totpCode: "123456" })).toBe(true)
    expect(withTotpThrottle).toHaveBeenCalledWith("u1", "reauth", expect.any(Function))
  })

  it("throttled: refuses even correct credentials without consulting any verifier", async () => {
    ;(withTotpThrottle as any).mockResolvedValueOnce("throttled")
    expect(await verifyReauthCredentials("u1", "hashedpw", { password: "correctpw", totpCode: "123456" })).toBe(false)
    expect(verifyPassword).not.toHaveBeenCalled()
    expect(verifyTotp).not.toHaveBeenCalled()
    expect(findUnusedRecoveryCode).not.toHaveBeenCalled()
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
    expect(revokeAllSessions).not.toHaveBeenCalled()
  })

  it("roadmap#280: requiring 2FA ends every open session of a user without TOTP", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ email: "target@example.com", totpEnabled: false })
    ;(prisma.user.update as any).mockResolvedValue({})
    ;(revokeAllSessions as any).mockResolvedValue(2)

    const res = await setUserRequire2faFlag("target-id", true, { id: "actor-1" })

    expect(res.status).toBe(200)
    expect(revokeAllSessions).toHaveBeenCalledWith("target-id")
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "2fa_required_for_user", details: { revokedSessions: 2 } }),
    )
  })

  it("roadmap#280: a user already enrolled keeps their sessions", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ email: "target@example.com", totpEnabled: true })
    ;(prisma.user.update as any).mockResolvedValue({})

    await setUserRequire2faFlag("target-id", true, { id: "actor-1" })

    expect(revokeAllSessions).not.toHaveBeenCalled()
  })
})
