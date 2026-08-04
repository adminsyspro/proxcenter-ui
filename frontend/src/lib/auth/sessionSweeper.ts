/**
 * Hourly purge of dead session rows.
 *
 * The `sessions` table carries `ipAddress` and `userAgent` — personal data.
 * evaluateSession()/isDeadPredicate() (sessions.ts) already say when a row is
 * dead, and login-time cleanup removes it for a user who signs in again, but
 * a user who never comes back would keep their IP forever. This sweeper is
 * what turns the retention bound into a fact rather than a claim.
 *
 * Timer discipline copied from job-heartbeat.ts: an in-flight guard so a slow
 * purge cannot overlap the next tick, unref() so the interval never keeps the
 * process alive by itself, and an error path that can never throw.
 */
import { purgeDeadSessions } from "@/lib/auth/sessions"

export const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000

export interface SessionSweeperOptions {
  intervalMs?: number
  purge?: () => Promise<number>
}

/**
 * Start the hourly dead-session sweep.
 *
 * Safe to run from every HA replica: the purge is a single deleteMany with a
 * time-based predicate, so concurrent runs are idempotent (no leader election
 * needed) and the only cost of N replicas is a redundant query per hour.
 *
 * @returns A stop() function, safe to call multiple times.
 */
export function startSessionSweeper(options: SessionSweeperOptions = {}): () => void {
  const { intervalMs = SESSION_SWEEP_INTERVAL_MS, purge = purgeDeadSessions } = options
  let stopped = false
  let inFlight = false

  const sweep = () => {
    if (stopped || inFlight) return
    inFlight = true
    purge()
      .then(
        (count) => {
          // An hourly "deleted 0 rows" line for the rest of the deployment's
          // life is noise that trains people to ignore the log.
          if (count > 0) console.log(`[session-sweeper] purged ${count} dead session row(s)`)
        },
        (err) => {
          console.error("[session-sweeper] purge failed (non-fatal):", err)
        },
      )
      .finally(() => { inFlight = false })
  }

  const timer = setInterval(sweep, intervalMs)
  // Do not keep the Node process alive just for this sweep timer.
  if (typeof (timer as any).unref === "function") (timer as any).unref()

  return function stop() {
    if (stopped) return
    stopped = true
    clearInterval(timer)
  }
}
