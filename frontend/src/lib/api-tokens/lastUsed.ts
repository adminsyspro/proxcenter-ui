// last_used_at / last_used_ip are rewritten AT MOST once per minute via a
// single conditional UPDATE, never a read-then-write (spec D5: a read+write
// pair cannot guarantee once-per-minute under concurrency). updateMany
// compiles to exactly one UPDATE ... WHERE statement.
import { prisma } from "@/lib/db/prisma"

const MIN_INTERVAL_MS = 60_000

export async function touchTokenUsage(tokenId: string, ip: string | null): Promise<void> {
  await prisma.apiToken.updateMany({
    where: {
      id: tokenId,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - MIN_INTERVAL_MS) } }],
    },
    data: { lastUsedAt: new Date(), lastUsedIp: ip },
  })
}
