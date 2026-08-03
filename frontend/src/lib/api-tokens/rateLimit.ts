// Per-token fixed-window rate limiting (spec D10). In-process on purpose:
// a DB-backed counter would cost one write per request, worse than the
// problem it solves. Under control-plane HA the effective limit multiplies
// by the number of active nodes (accepted, documented).
const WINDOW_MS = 60_000

export type RateLimitVerdict = {
  allowed: boolean
  limit: number
  remaining: number
  /** Seconds until the current window resets (RateLimit-Reset). */
  reset: number
  /** Seconds to wait (Retry-After); 0 when allowed. */
  retryAfter: number
}

type Counter = { windowStart: number; count: number }

const counters = new Map<string, Counter>()
let lastSweepAt = 0

/** Evict entries older than the window, at most once per window (unlike PegaProx's never-purged dict). */
function sweep(nowMs: number): void {
  if (nowMs - lastSweepAt < WINDOW_MS) return
  lastSweepAt = nowMs
  for (const [tokenId, counter] of counters) {
    if (counter.windowStart <= nowMs - WINDOW_MS) counters.delete(tokenId)
  }
}

export function consumeRateLimit(tokenId: string, limit: number, nowMs = Date.now()): RateLimitVerdict {
  sweep(nowMs)
  const windowStart = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS
  let counter = counters.get(tokenId)
  if (!counter || counter.windowStart !== windowStart) {
    counter = { windowStart, count: 0 }
    counters.set(tokenId, counter)
  }
  const reset = Math.max(1, Math.ceil((windowStart + WINDOW_MS - nowMs) / 1000))
  if (counter.count >= limit) {
    return { allowed: false, limit, remaining: 0, reset, retryAfter: reset }
  }
  counter.count += 1
  return { allowed: true, limit, remaining: limit - counter.count, reset, retryAfter: 0 }
}

/** @internal test hooks */
export function _resetRateLimitCounters(): void {
  counters.clear()
  lastSweepAt = 0
}

export function _countersSize(): number {
  return counters.size
}
