import { describe, expect, it, vi, beforeEach } from "vitest"
import { verifyTotpOrRecovery } from "./verify-second-factor"

vi.mock("./totp", () => ({ verifyTotp: vi.fn() }))
vi.mock("./recovery", () => ({
  consumeRecoveryCode: vi.fn(),
  countRemainingRecoveryCodes: vi.fn().mockResolvedValue(9),
  RECOVERY_CODE_PATTERN: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/,
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

import { verifyTotp } from "./totp"
import { consumeRecoveryCode } from "./recovery"
import { audit } from "@/lib/audit"

describe("verifyTotpOrRecovery", () => {
  beforeEach(() => vi.clearAllMocks())

  it("routes a 6-digit code to verifyTotp", async () => {
    ;(verifyTotp as any).mockResolvedValue(true)
    const ok = await verifyTotpOrRecovery("u1", "123456", "1.1.1.1")
    expect(ok).toBe(true)
    expect(verifyTotp).toHaveBeenCalledWith("u1", "123456")
    expect(consumeRecoveryCode).not.toHaveBeenCalled()
  })

  it("routes XXXXX-XXXXX to consumeRecoveryCode and audits", async () => {
    ;(consumeRecoveryCode as any).mockResolvedValue(true)
    const ok = await verifyTotpOrRecovery("u1", "ABCDE-FGHJK", "2.2.2.2")
    expect(ok).toBe(true)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "2fa_recovery_used",
      status: "success",
    }))
  })

  it("audits failure on invalid totp", async () => {
    ;(verifyTotp as any).mockResolvedValue(false)
    await verifyTotpOrRecovery("u1", "000000", null)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "2fa_login_failed",
      status: "failure",
    }))
  })
})
