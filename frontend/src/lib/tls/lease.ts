// src/lib/tls/lease.ts
//
// One HA replica at a time may place an ACME order. This is a lease row and
// not pg_try_advisory_lock, and the difference is not cosmetic:
//
//   - Prisma's pg adapter runs every raw call on whatever pooled connection it
//     is handed, so the acquire and the release generally land on DIFFERENT
//     backend sessions;
//   - pg_advisory_unlock returns false and logs a warning — it does not throw —
//     when the calling session does not hold the lock.
//
// Together those two mean the release silently no-ops while the lock stays held
// on the acquiring connection, for the life of that connection. No replica ever
// renews again, and nothing says so.
//
// Wrapping the order in prisma.$transaction would pin one connection, but an
// ACME order takes minutes: holding a pooled connection and an open snapshot
// across network I/O to a third party trades this bug for a worse one.
//
// A lease row has neither problem. It is claimed and released by value, so
// which connection carries the statement is irrelevant, and a replica that
// crashes mid-order stops refreshing it: the lease simply expires.

import { prisma } from '@/lib/db/prisma'
import { resolveInstanceId } from '@/lib/migration/orphan-sweep'

/** The table holds exactly this one row; the id is a constant, not a key space. */
export const RENEW_LEASE_ID = 'acme-renew'

/**
 * Long enough for a slow ACME order (preflight, order, challenge validation,
 * finalize) plus a margin, short enough that a replica killed mid-order does
 * not block the next renewal for a meaningful fraction of renewBeforeDays.
 */
export const RENEW_LEASE_TTL_MINUTES = 15

/**
 * How often the holder pushes `held_until` forward while the order runs. The
 * lease has to outlive the work, and the work has no bound of its own: the
 * installed ACME client is configured with a request timeout of 0, so a stalled
 * CA request or a long Retry-After can run past fifteen minutes and let a second
 * replica claim the row while the first order is still in flight — the exact
 * overlap the lease exists to prevent.
 */
export const RENEW_LEASE_REFRESH_MS = 60_000

/**
 * And a ceiling on the whole thing, because a heartbeat that never stops is a
 * lease that never expires — the advisory lock's failure mode with extra steps.
 * Past this, the holder stops refreshing, gives up waiting, and marks its own
 * handle lost so a late-finishing order cannot publish behind its back. Thirty
 * minutes is far beyond any healthy order; Let's Encrypt answers in seconds.
 */
export const RENEW_LEASE_MAX_MS = 30 * 60_000

/**
 * Raw SQL is NOT rewritten by the pg adapter's `schema` option — that option
 * only reaches the queries the engine generates itself — so an unqualified
 * table name resolves against the connection's search_path. In production that
 * is `public` and all is well; under vitest, where globalSetup runs each suite
 * in its own `test_*` schema, it would silently hit (or fail to find) the
 * developer's own database. Qualify the name from the same `?schema=` the
 * client itself parses out of DATABASE_URL.
 */
function leaseTable(): string {
  let schema = 'public'

  try {
    const fromQuery = new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema')

    if (fromQuery) schema = fromQuery
  } catch {
    // A DSN new URL() cannot parse leaves the default in place.
  }

  return `"${schema.replace(/"/g, '""')}"."tls_renew_leases"`
}

/**
 * Every timestamp below is `now() AT TIME ZONE 'UTC'` and never a bare `now()`.
 * `held_until` is `timestamp(3) WITHOUT time zone` holding UTC, which is how
 * Prisma stores a DateTime; comparing it against a `timestamptz` would make the
 * answer depend on the session's TimeZone setting.
 *
 * The clock is the server's, for the same reason: with a JS-side `new Date()`
 * each replica would judge expiry on its own clock, and one replica running
 * fast would steal a lease another one is still holding.
 */
const NOW_UTC = "(now() AT TIME ZONE 'UTC')"

/**
 * One statement, so exactly one replica can win: the insert covers the
 * first-ever claim, the ON CONFLICT covers every later one, and its WHERE makes
 * the update fire only on an expired lease. Two replicas racing serialise on
 * the row lock, and the loser re-evaluates the WHERE against the winner's
 * committed row and updates nothing.
 *
 * Returns true when this holder now owns the lease.
 */
export async function claimRenewLease(holder: string): Promise<boolean> {
  const affected = await prisma.$executeRawUnsafe(
    `INSERT INTO ${leaseTable()} AS lease ("id", "holder", "held_until", "updated_at")
     VALUES ($1, $2, ${NOW_UTC} + interval '${RENEW_LEASE_TTL_MINUTES} minutes', ${NOW_UTC})
     ON CONFLICT ("id") DO UPDATE
       SET "holder" = EXCLUDED."holder",
           "held_until" = EXCLUDED."held_until",
           "updated_at" = EXCLUDED."updated_at"
       WHERE lease."held_until" < ${NOW_UTC}`,
    RENEW_LEASE_ID,
    holder,
  )

  return affected > 0
}

/**
 * Expire the lease immediately so the next tick on any replica can take it.
 * Guarded on the holder: a replica whose lease has already been taken over must
 * not cut short the one now doing the work.
 *
 * Returns true when this holder actually held the lease it just released.
 */
export async function releaseRenewLease(holder: string): Promise<boolean> {
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE ${leaseTable()}
        SET "held_until" = ${NOW_UTC}, "updated_at" = ${NOW_UTC}
      WHERE "id" = $1 AND "holder" = $2`,
    RENEW_LEASE_ID,
    holder,
  )

  return affected > 0
}

/**
 * Push `held_until` forward, but only while we genuinely still hold the lease:
 * `held_until > now()` as well as the holder guard. A lease that has already
 * lapsed must NOT be silently extended — another replica may claim it at any
 * instant, and re-extending would put two orders on the wire at once, which is
 * the whole thing this row exists to stop.
 *
 * Returns false when the lease is no longer ours to refresh.
 */
export async function refreshRenewLease(holder: string): Promise<boolean> {
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE ${leaseTable()}
        SET "held_until" = ${NOW_UTC} + interval '${RENEW_LEASE_TTL_MINUTES} minutes', "updated_at" = ${NOW_UTC}
      WHERE "id" = $1 AND "holder" = $2 AND "held_until" > ${NOW_UTC}`,
    RENEW_LEASE_ID,
    holder,
  )

  return affected > 0
}

/**
 * What the work is handed so it can ask, at the moment that matters, whether it
 * is still the replica entitled to publish. An ACME order cannot be called
 * back once the CA holds it, so the fence is placed where the damage would be
 * done rather than where the request hangs.
 */
export interface RenewLeaseHandle {
  /** False once a refresh found the lease gone, or the ceiling was reached. */
  isHeld(): boolean
  /** Throws rather than returning, for use immediately before publishing. */
  assertHeld(): void
}

export class RenewLeaseLostError extends Error {
  constructor() {
    super('the renewal lease was lost to another replica while the order was running')
    this.name = 'RenewLeaseLostError'
  }
}

/**
 * Run `work` under the lease, or not at all. Resolves to false when another
 * replica holds it — the caller has nothing to do in that case, its neighbour
 * is already ordering.
 *
 * While the work runs the lease is refreshed on a timer, and the handle passed
 * to the work turns false the moment that stops being possible.
 */
export async function withRenewLease(
  work: (lease: RenewLeaseHandle) => Promise<void>,
  // Overridable so the heartbeat and the ceiling can be exercised in a test
  // without waiting minutes for them; production never passes either.
  timing: { refreshMs?: number; maxMs?: number } = {},
): Promise<boolean> {
  const { refreshMs = RENEW_LEASE_REFRESH_MS, maxMs = RENEW_LEASE_MAX_MS } = timing
  const holder = resolveInstanceId()

  if (!(await claimRenewLease(holder))) return false

  let held = true

  const handle: RenewLeaseHandle = {
    isHeld: () => held,
    assertHeld: () => {
      if (!held) throw new RenewLeaseLostError()
    },
  }

  const heartbeat = setInterval(() => {
    void refreshRenewLease(holder)
      .then(stillOurs => {
        if (stillOurs) return
        console.error('[tls] the renewal lease was taken over by another replica; abandoning this order')
        held = false
      })
      .catch(err => {
        // A refresh that cannot reach the database is not proof the lease is
        // gone, so ownership is left alone; the ceiling below still applies.
        console.error('[tls] could not refresh the renewal lease:', err)
      })
  }, refreshMs)

  // Never let the heartbeat hold the process open, exactly as the reconciler's
  // own interval does.
  if (typeof (heartbeat as any).unref === 'function') (heartbeat as any).unref()

  // The work promise is kept and given its own catch: once the ceiling fires we
  // stop awaiting it, and a rejection landing later must not surface as an
  // unhandled rejection.
  const running = work(handle)

  running.catch(() => {})

  let ceiling: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      running,
      new Promise<never>((_resolve, reject) => {
        ceiling = setTimeout(() => {
          held = false
          reject(new RenewLeaseLostError())
        }, maxMs)

        if (typeof (ceiling as any).unref === 'function') (ceiling as any).unref()
      }),
    ])
  } finally {
    clearInterval(heartbeat)
    if (ceiling) clearTimeout(ceiling)

    try {
      await releaseRenewLease(holder)
    } catch (err) {
      // The work is done either way, and the lease expires on its own; a
      // failed release must not replace the caller's error with its own.
      console.error('[tls] releasing the renewal lease failed (it will expire on its own):', err)
    }
  }

  return true
}
