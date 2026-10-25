// src/lib/tls/reconciler.ts
//
// Hourly tick. Three jobs, in this order: bring the running listener in line
// with the database (which is also how an HA replica picks up a certificate
// renewed by another one), renew an ACME certificate that is close to its
// end, and purge the challenges nobody will collect.
//
// Timer discipline copied from sessionSweeper.ts: an in-flight guard, unref()
// so the interval never keeps the process alive, and an error path that can
// never throw.

import { applyActiveCertificate } from '@/lib/tls/bootstrap'
import { purgeExpiredChallenges } from '@/lib/tls/challengeStore'
import { withRenewLease } from '@/lib/tls/lease'
import { runAcmeOrder, shouldRenew } from '@/lib/tls/renew'
import { loadTlsSettings } from '@/lib/tls/settings'
import { getActiveSummary } from '@/lib/tls/store'

export const TLS_RECONCILE_INTERVAL_MS = 60 * 60 * 1000

export function startTlsReconciler(options: { intervalMs?: number } = {}): () => void {
  const { intervalMs = TLS_RECONCILE_INTERVAL_MS } = options

  let stopped = false
  let inFlight = false

  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true

    try {
      await applyActiveCertificate()

      const settings = await loadTlsSettings()
      const active = await getActiveSummary()

      if (shouldRenew(settings, active)) {
        // Renewing from several replicas at once would place several orders
        // against the same account for the same names, which is exactly what a
        // rate limit is there to punish. withRenewLease resolves to false when
        // a neighbour already holds it: there is nothing to do in that case.
        await withRenewLease(async lease => {
          const result = await runAcmeOrder('renewal', { assertStillEntitled: lease.assertHeld })

          // Same guard again on the way out: applying a certificate we are no
          // longer entitled to publish would put this replica's listener at
          // odds with the one that now holds the lease.
          lease.assertHeld()

          if (result.ok) await applyActiveCertificate()
        })
      }

      const purged = await purgeExpiredChallenges()

      if (purged > 0) console.log(`[tls] purged ${purged} expired ACME challenge(s)`)
    } catch (err) {
      console.error('[tls] reconcile tick failed (non-fatal):', err)
    } finally {
      inFlight = false
    }
  }

  const timer = setInterval(tick, intervalMs)

  if (typeof (timer as any).unref === 'function') (timer as any).unref()
  void tick()

  return () => {
    stopped = true
    clearInterval(timer)
  }
}
