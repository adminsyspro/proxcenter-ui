// src/lib/tls/challengeStore.ts
//
// Pending HTTP-01 key authorizations. In the database and not in memory: in
// HA the CA resolves one name to a load balancer and can validate against a
// replica other than the one that placed the order.

import { prisma } from '@/lib/db/prisma'

/** Well beyond the few seconds a CA takes, short enough to bound the table. */
export const CHALLENGE_TTL_MS = 30 * 60 * 1000

export async function putChallenge(token: string, keyAuth: string, domain: string): Promise<void> {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)

  await prisma.tlsAcmeChallenge.upsert({
    where: { token },
    update: { keyAuth, domain, expiresAt },
    create: { token, keyAuth, domain, expiresAt },
  })
}

export async function takeChallenge(token: string): Promise<string | null> {
  const row = await prisma.tlsAcmeChallenge.findUnique({ where: { token } })

  if (!row) return null
  if (row.expiresAt.getTime() <= Date.now()) return null

  return row.keyAuth
}

export async function dropChallenge(token: string): Promise<void> {
  await prisma.tlsAcmeChallenge.delete({ where: { token } }).catch(() => undefined)
}

export async function purgeExpiredChallenges(): Promise<number> {
  const { count } = await prisma.tlsAcmeChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } })

  return count
}
