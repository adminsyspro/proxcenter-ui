import crypto from "node:crypto"
import { prisma } from "@/lib/db/prisma"

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const SEGMENT_LENGTH = 5
const SEGMENTS = 2

// High-entropy random tokens; lower iteration count than password.ts (which
// uses 100k) is intentional and adequate against offline attacks at this
// entropy level, while keeping the 10-row verify pass under 30ms.
const PBKDF2_ITERATIONS = 10000
const KEY_LENGTH = 64
const DIGEST = "sha512"

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

function deriveHash(plain: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(plain, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST, (err, key) => {
      if (err) reject(err)
      else resolve(key.toString("hex"))
    })
  })
}

export async function hashRecoveryCode(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex")
  const derived = await deriveHash(plain, salt)
  return `${salt}:${derived}`
}

async function compareRecoveryCode(plain: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(":")
  if (!salt || !expected) return false
  const derived = await deriveHash(plain, salt)
  const a = Buffer.from(derived, "hex")
  const b = Buffer.from(expected, "hex")
  return a.length === b.length && crypto.timingSafeEqual(a, b)
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
    if (await compareRecoveryCode(candidate, row.codeHash)) {
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
