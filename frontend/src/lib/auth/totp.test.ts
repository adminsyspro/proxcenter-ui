import { describe, expect, it, beforeEach, vi } from "vitest"
import { authenticator } from "otplib"
import { generateTotpSecret, buildOtpauthUrl, verifyTotp, encryptTotpSecret } from "./totp"

vi.mock("@/lib/db/prisma", () => {
  const usersUpdateMany = vi.fn()
  const usersFindUnique = vi.fn()
  return {
    prisma: {
      user: {
        updateMany: usersUpdateMany,
        findUnique: usersFindUnique,
      },
    },
  }
})

vi.mock("@/lib/crypto/secret", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
}))

import { prisma } from "@/lib/db/prisma"

describe("totp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("encryptTotpSecret delegates to encryptSecret", () => {
    expect(encryptTotpSecret("plain")).toBe("enc:plain")
  })

  it("generates a base32 secret of at least 32 chars", () => {
    const s = generateTotpSecret()
    expect(s).toMatch(/^[A-Z2-7]+$/)
    expect(s.length).toBeGreaterThanOrEqual(32)
  })

  it("builds an otpauth url with issuer and label", () => {
    const url = buildOtpauthUrl("alice@example.com", "AAAAAAAA", "ProxCenter")
    expect(url).toMatch(/^otpauth:\/\/totp\/ProxCenter:alice(%40|@)example\.com\?/)
    expect(url).toContain("issuer=ProxCenter")
    expect(url).toContain("secret=AAAAAAAA")
  })

  it("accepts a valid code and advances the high-water mark", async () => {
    const secret = generateTotpSecret()
    ;(prisma.user.findUnique as any).mockResolvedValue({
      totpSecretEnc: `enc:${secret}`,
      totpLastUsedStep: null,
    })
    ;(prisma.user.updateMany as any).mockResolvedValue({ count: 1 })

    const code = authenticator.generate(secret)
    const ok = await verifyTotp("user1", code)

    expect(ok).toBe(true)
    expect(prisma.user.updateMany).toHaveBeenCalledOnce()
  })

  it("rejects an invalid code without DB write", async () => {
    const secret = generateTotpSecret()
    ;(prisma.user.findUnique as any).mockResolvedValue({
      totpSecretEnc: `enc:${secret}`,
      totpLastUsedStep: null,
    })

    const ok = await verifyTotp("user1", "000000")

    expect(ok).toBe(false)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it("rejects replay: updateMany returning 0 rows means already-consumed step", async () => {
    const secret = generateTotpSecret()
    ;(prisma.user.findUnique as any).mockResolvedValue({
      totpSecretEnc: `enc:${secret}`,
      totpLastUsedStep: BigInt(Math.floor(Date.now() / 1000 / 30)),
    })
    ;(prisma.user.updateMany as any).mockResolvedValue({ count: 0 })

    const code = authenticator.generate(secret)
    const ok = await verifyTotp("user1", code)

    expect(ok).toBe(false)
  })

  it("returns false when user has no TOTP secret stored", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      totpSecretEnc: null,
      totpLastUsedStep: null,
    })

    const ok = await verifyTotp("user1", "123456")

    expect(ok).toBe(false)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })
})
