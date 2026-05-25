import crypto from "crypto"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db/prisma"

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const SEGMENT_LENGTH = 5
const SEGMENTS = 2
const BCRYPT_COST = 12

export const RECOVERY_CODE_PATTERN = /^[A-Z2-9]{5}-[A-Z2-9]{5}$/

function randomChar(): string {
  return ALPHABET[crypto.randomInt(ALPHABET.length)]
}

function generateOne(): string {
  const parts: string[] = []
  for (let s = 0; s < SEGMENTS; s++) {
    let seg = ""
    for (let i = 0; i < SEGMENT_LENGTH; i++) seg += randomChar()
    parts.push(seg)
  }
  return parts.join("-")
}

export function generateRecoveryCodes(count: number = 10): string[] {
  const out = new Set<string>()
  while (out.size < count) out.add(generateOne())
  return [...out]
}

export async function hashRecoveryCode(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

export async function consumeRecoveryCode(
  userId: string,
  candidate: string,
  ip: string | null,
): Promise<boolean> {
  if (!RECOVERY_CODE_PATTERN.test(candidate)) return false

  const rows = await prisma.userTotpRecoveryCode.findMany({
    where: { userId, consumedAt: null },
    select: { id: true, codeHash: true },
  })

  for (const row of rows) {
    if (await bcrypt.compare(candidate, row.codeHash)) {
      const result = await prisma.userTotpRecoveryCode.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: new Date(), consumedIp: ip ?? undefined },
      })
      return result.count === 1
    }
  }

  return false
}

export async function countRemainingRecoveryCodes(userId: string): Promise<number> {
  return prisma.userTotpRecoveryCode.count({
    where: { userId, consumedAt: null },
  })
}
