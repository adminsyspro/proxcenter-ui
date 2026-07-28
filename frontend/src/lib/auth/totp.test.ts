import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { generateSync } from "otplib"
import {
  generateTotpSecret,
  buildOtpauthUrl,
  verifyTotp,
  encryptTotpSecret,
  checkTotpCode,
} from "./totp"

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

/** Generate a currently-valid code the way an authenticator app would. */
function generateCode(secret: string): string {
  return generateSync({ secret, digits: 6, period: 30 })
}

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

    const code = generateCode(secret)
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

    const code = generateCode(secret)
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

describe("otplib v12 -> v13 interoperability (already-enrolled users)", () => {
  // Reference vectors computed with otplib 12.0.1 — the exact version this app
  // ran before the migration and therefore what already-enrolled users' apps
  // were verified against at enrolment time:
  //   const { authenticator } = require("otplib") // 12.0.1
  //   authenticator.options = { window: 1, step: 30, digits: 6, epoch: EPOCH_MS }
  //   authenticator.generate(SECRET)
  // TOTP is deterministic, so if v13 accepts these codes at this timestamp
  // with the same window, existing users can still log in.
  const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" // 20 bytes, same shape as generateTotpSecret()
  const EPOCH_MS = 1_700_000_000_000 // 2023-11-14T22:13:20.000Z
  const STEP_AT_EPOCH = 56_666_666n // floor(1_700_000_000 / 30)
  const V12_CODE_AT_EPOCH = "406058"
  const V12_CODE_PREV_STEP = "797823" // generated at EPOCH_MS - 30 s
  const V12_CODE_NEXT_STEP = "661763" // generated at EPOCH_MS + 30 s
  const V12_CODE_TWO_STEPS_AHEAD = "996875" // generated at EPOCH_MS + 60 s

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(EPOCH_MS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function primeUser(lastUsedStep: bigint | null = null) {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      totpSecretEnc: `enc:${SECRET}`,
      totpLastUsedStep: lastUsedStep,
    })
    ;(prisma.user.updateMany as any).mockResolvedValue({ count: 1 })
  }

  it("v13 generates the exact code v12 generated for the same secret and time", () => {
    expect(generateCode(SECRET)).toBe(V12_CODE_AT_EPOCH)
  })

  it("verifyTotp accepts a v12-era code and stores the matched step", async () => {
    primeUser()

    const ok = await verifyTotp("user1", V12_CODE_AT_EPOCH)

    expect(ok).toBe(true)
    const updateArgs = (prisma.user.updateMany as any).mock.calls[0][0]
    expect(updateArgs.data.totpLastUsedStep).toBe(STEP_AT_EPOCH)
  })

  it("keeps the v12 window:1 policy — previous and next step accepted", () => {
    expect(checkTotpCode(V12_CODE_PREV_STEP, SECRET)).toBe(true)
    expect(checkTotpCode(V12_CODE_NEXT_STEP, SECRET)).toBe(true)
  })

  it("keeps the v12 window:1 policy — two steps of drift rejected", () => {
    expect(checkTotpCode(V12_CODE_TWO_STEPS_AHEAD, SECRET)).toBe(false)
  })

  it("stores the matched (previous) step, not the current one, for drifted codes", async () => {
    primeUser()

    const ok = await verifyTotp("user1", V12_CODE_PREV_STEP)

    expect(ok).toBe(true)
    const updateArgs = (prisma.user.updateMany as any).mock.calls[0][0]
    expect(updateArgs.data.totpLastUsedStep).toBe(STEP_AT_EPOCH - 1n)
  })

  it("checkTotpCode accepts the enrolment code the way v12 authenticator.check did", () => {
    expect(checkTotpCode(V12_CODE_AT_EPOCH, SECRET)).toBe(true)
  })

  it("returns false (never throws) on empty or malformed input, like v12", async () => {
    // v13 throws on these; the wrapper must preserve the v12 false/null
    // contract that verifyReauthCredentials (totp-admin.ts) relies on.
    expect(checkTotpCode("", SECRET)).toBe(false)
    expect(checkTotpCode("abcdef", SECRET)).toBe(false)
    expect(checkTotpCode("123", SECRET)).toBe(false)
    expect(checkTotpCode("12345678", SECRET)).toBe(false)
    expect(checkTotpCode(" 406058 ", SECRET)).toBe(false)

    primeUser()
    await expect(verifyTotp("user1", "")).resolves.toBe(false)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })
})
