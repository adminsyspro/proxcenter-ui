// Pure token crypto primitives (no DB). Secret format (spec D5):
// pxc_ + 32 random bytes base64url. Prefix = pxc_ + first 8 chars of the
// random part (lookup key + only value ever displayed). Hash = HMAC-SHA-256
// hex peppered by APP_SECRET (already the at-rest secret key, see
// frontend/src/lib/crypto/secret.ts and frontend/src/lib/internal-auth.ts:37).
import { createHmac, randomBytes } from "node:crypto"

import { constantTimeStringEqual } from "@/lib/crypto/constantTime"

const PREFIX_RANDOM_CHARS = 8

export type GeneratedToken = { secret: string; prefix: string; hash: string }

export function extractTokenPrefix(secret: string): string | null {
  if (!secret.startsWith("pxc_")) return null
  if (secret.length < 4 + PREFIX_RANDOM_CHARS) return null
  return secret.slice(0, 4 + PREFIX_RANDOM_CHARS)
}

export function hashApiToken(secret: string): string {
  const pepper = process.env.APP_SECRET || ""
  if (!pepper) throw new Error("APP_SECRET is required to hash API tokens")
  return createHmac("sha256", pepper).update(secret, "utf8").digest("hex")
}

// Shared constant-time compare (frontend/src/lib/crypto/constantTime.ts):
// equal-length dummy compare on mismatch so no length oracle leaks.
export function verifyTokenHash(secret: string, storedHash: string): boolean {
  return constantTimeStringEqual(hashApiToken(secret), storedHash)
}

export function generateApiToken(): GeneratedToken {
  const secret = `pxc_${randomBytes(32).toString("base64url")}`
  return {
    secret,
    prefix: extractTokenPrefix(secret) as string,
    hash: hashApiToken(secret),
  }
}
