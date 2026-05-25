import { authenticator } from "otplib"
import { prisma } from "@/lib/db/prisma"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret"

authenticator.options = { window: 1, step: 30, digits: 6 }

const TOTP_STEP_SECONDS = 30

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20)
}

export function encryptTotpSecret(plain: string): string {
  return encryptSecret(plain)
}

export function buildOtpauthUrl(
  email: string,
  secret: string,
  issuer: string = "ProxCenter",
): string {
  return authenticator.keyuri(email, issuer, secret)
}

function currentStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS)
}

export async function verifyTotp(userId: string, code: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecretEnc: true, totpLastUsedStep: true },
  })
  if (!row?.totpSecretEnc) return false

  const secret = decryptSecret(row.totpSecretEnc)
  const delta = authenticator.checkDelta(code, secret)
  if (delta === null) return false

  const matched = BigInt(currentStep() + delta)

  const result = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [
        { totpLastUsedStep: null },
        { totpLastUsedStep: { lt: matched } },
      ],
    },
    data: { totpLastUsedStep: matched },
  })

  return result.count === 1
}
