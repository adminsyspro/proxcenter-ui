import { verifyTotp } from "./totp"
import { consumeRecoveryCode, countRemainingRecoveryCodes, RECOVERY_CODE_PATTERN } from "./recovery"
import { audit } from "@/lib/audit"

const TOTP_PATTERN = /^\d{6}$/

export async function verifyTotpOrRecovery(
  userId: string,
  code: string,
  ip: string | null,
): Promise<boolean> {
  if (TOTP_PATTERN.test(code)) {
    const ok = await verifyTotp(userId, code)
    if (!ok) {
      await audit({
        action: "2fa_login_failed",
        category: "auth",
        userId,
        status: "failure",
        details: { reason: "invalid_code" },
      })
    }
    return ok
  }

  if (RECOVERY_CODE_PATTERN.test(code)) {
    const ok = await consumeRecoveryCode(userId, code, ip)
    if (ok) {
      const remaining = await countRemainingRecoveryCodes(userId)
      await audit({
        action: "2fa_recovery_used",
        category: "auth",
        userId,
        status: "success",
        details: { remaining },
      })
      if (remaining < 3) {
        await audit({
          action: "2fa_recovery_low",
          category: "auth",
          userId,
          status: "warning" as any,
          details: { remaining },
        })
      }
    } else {
      await audit({
        action: "2fa_login_failed",
        category: "auth",
        userId,
        status: "failure",
        details: { reason: "invalid_recovery" },
      })
    }
    return ok
  }

  await audit({
    action: "2fa_login_failed",
    category: "auth",
    userId,
    status: "failure",
    details: { reason: "malformed" },
  })
  return false
}
