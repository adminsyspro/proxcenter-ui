import { generateSecret, generateURI, verifySync } from "otplib"
import { prisma } from "@/lib/db/prisma"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret"

/**
 * TOTP parameters. These were `authenticator.options = { window: 1, step: 30,
 * digits: 6 }` on otplib v12 and MUST NOT change: enrolled users' apps
 * generate codes with step 30 / 6 digits, and window 1 (one step of drift in
 * either direction) is the acceptance policy their logins rely on.
 *
 * otplib v13 has no shared authenticator singleton; options are passed per
 * call and the acceptance window is expressed as a time tolerance in seconds
 * (`epochTolerance`). A tolerance of exactly one step (30 s) accepts codes
 * from the previous, current and next step and nothing else, which is
 * identical to the v12 `window: 1` behaviour (pinned by the interop tests
 * in totp.test.ts).
 */
const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6
const TOTP_WINDOW_STEPS = 1
const TOTP_EPOCH_TOLERANCE_SECONDS = TOTP_WINDOW_STEPS * TOTP_STEP_SECONDS
const TOTP_SECRET_BYTES = 20

/** Flat result shape (tsconfig strict:false does not narrow unions well). */
type TotpCheckResult = { valid: boolean; timeStep?: number }

/**
 * Verify a TOTP code against a base32 secret with our fixed parameters.
 * otplib v13 throws on malformed tokens (empty, non-digits, wrong length)
 * where v12 returned false; callers rely on the v12 contract (see
 * verifyReauthCredentials in totp-admin.ts), so fail closed instead of
 * throwing. `timeStep` is the absolute 30-second step the code matched.
 */
function safeVerifyTotpCode(code: string, secret: string): TotpCheckResult {
  try {
    return verifySync({
      secret,
      token: code,
      digits: TOTP_DIGITS,
      period: TOTP_STEP_SECONDS,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    })
  } catch {
    return { valid: false }
  }
}

/**
 * Boolean check used by the enrolment route (v12: authenticator.check).
 * Returns false (never throws) on empty or malformed input.
 */
export function checkTotpCode(code: string, secret: string): boolean {
  return safeVerifyTotpCode(code, secret).valid
}

export function generateTotpSecret(): string {
  return generateSecret({ length: TOTP_SECRET_BYTES })
}

export function encryptTotpSecret(plain: string): string {
  return encryptSecret(plain)
}

export function buildOtpauthUrl(
  email: string,
  secret: string,
  issuer: string = "ProxCenter",
): string {
  return generateURI({
    issuer,
    label: email,
    secret,
    digits: TOTP_DIGITS,
    period: TOTP_STEP_SECONDS,
  })
}

export async function verifyTotp(userId: string, code: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecretEnc: true, totpLastUsedStep: true },
  })
  if (!row?.totpSecretEnc) return false

  const secret = decryptSecret(row.totpSecretEnc)
  const result = safeVerifyTotpCode(code, secret)
  if (!result.valid || result.timeStep === undefined) return false

  // Absolute step the code matched (v12: currentStep() + checkDelta result).
  const matched = BigInt(result.timeStep)

  const updated = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [
        { totpLastUsedStep: null },
        { totpLastUsedStep: { lt: matched } },
      ],
    },
    data: { totpLastUsedStep: matched },
  })

  return updated.count === 1
}
