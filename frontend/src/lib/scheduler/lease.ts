/**
 * Database lease that elects one process to run a periodic job.
 *
 * Several frontends can share one database: the HA replicas in production,
 * and every dev server of a workstation. A job whose effect is not idempotent
 * (one history row per period) must run in exactly one of them. A Postgres
 * advisory lock would tie the election to one pooled connection, which Prisma
 * does not let us pin outside a transaction, and holding a transaction open
 * for a whole pass of slow hypervisor calls would starve the pool. A lease row
 * avoids both: one conditional UPDATE renews or takes over an expired lease
 * (Postgres re-checks its WHERE on a concurrent update, so two contenders
 * cannot both win), the primary key settles a race on the first insert, and a
 * holder that dies simply stops renewing and loses the lease at expiresAt.
 *
 * Expiry is read from each replica's clock: NTP keeps them within a second or
 * so, far below the minutes a lease lasts.
 */
import { prisma } from '@/lib/db/prisma'

/**
 * Take the lease `name` for `holder`, or renew it when `holder` already has
 * it. Succeeds only when the row is absent, expired, or held by `holder`.
 *
 * @returns true when `holder` owns the lease for the next `ttlMs`.
 */
export async function tryAcquireLease(name: string, holder: string, ttlMs: number, now: Date = new Date()): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs)

  const { count } = await prisma.schedulerLease.updateMany({
    where: { name, OR: [{ holder }, { expiresAt: { lt: now } }] },
    data: { holder, expiresAt },
  })

  if (count === 1) return true

  // No row yet, or a live one held by someone else. ON CONFLICT DO NOTHING
  // settles a race on the first insert without an error (a caught P2002
  // would still be logged by the client on every tick of every replica).
  const created = await prisma.schedulerLease.createMany({ data: [{ name, holder, expiresAt }], skipDuplicates: true })

  return created.count === 1
}

/** Give the lease back early (process stopping). A lease held by someone else is left alone. */
export async function releaseLease(name: string, holder: string): Promise<void> {
  await prisma.schedulerLease.deleteMany({ where: { name, holder } })
}
