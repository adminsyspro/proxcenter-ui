// src/lib/k8s/clusterHealthStatus.ts
// Client-side derivation for the cluster "integrating" (never-checked) state
// and the post-deploy health poll. No server dependency: the poll is
// parameterized over fetchState + delay so it is unit-testable without a
// network or real timers.

export interface HealthCheckable {
  lastHealthAt?: string | null
}

// A cluster is "integrating" (show a loader instead of a grey pill) when it
// has never resolved a health check yet: lastHealthAt is null/undefined.
// Once any check persists (lastHealthAt set), the real state is shown.
export function isIntegrating(c: HealthCheckable): boolean {
  return c.lastHealthAt == null
}

// A health check that landed a definitive good result: stop polling.
const RESOLVED_GOOD = new Set(['healthy', 'degraded'])

export interface PollOptions {
  fetchState: (clusterId: string) => Promise<string | null>
  intervalMs?: number
  timeoutMs?: number
  now?: () => number
  delay?: (ms: number) => Promise<void>
}

// Polls a freshly-deployed cluster's health until it resolves to a good state
// (healthy|degraded), tolerating transient unreachable/auth_failed/unknown
// (the RKE2 dynamiclistener x509 window right after boot). Returns the final
// good state, or the last-seen state at the timeout ceiling. Never throws.
export async function pollClusterHealthUntilResolved(
  clusterId: string,
  opts: PollOptions,
): Promise<string | null> {
  const intervalMs = opts.intervalMs ?? 12000
  const timeoutMs = opts.timeoutMs ?? 180000
  const now = opts.now ?? Date.now
  const delay = opts.delay ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const start = now()
  let last: string | null = null
  for (;;) {
    try {
      const state = await opts.fetchState(clusterId)
      last = state
      if (state && RESOLVED_GOOD.has(state)) return state
    } catch {
      // transient (network / x509 window) - keep polling until the ceiling
    }
    if (now() - start >= timeoutMs) return last
    await delay(intervalMs)
  }
}
