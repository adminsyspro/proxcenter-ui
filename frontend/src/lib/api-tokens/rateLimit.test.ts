import { describe, expect, it, beforeEach } from 'vitest'

import { consumeRateLimit, _resetRateLimitCounters, _countersSize } from './rateLimit'

beforeEach(() => {
  _resetRateLimitCounters()
})

describe('consumeRateLimit (fixed 60s window per token)', () => {
  it('allows up to the limit then denies with a real retryAfter', () => {
    const t0 = 1_000_000_000_000
    for (let i = 0; i < 3; i++) {
      const v = consumeRateLimit('tok', 3, t0 + i)
      expect(v.allowed).toBe(true)
      expect(v.limit).toBe(3)
      expect(v.remaining).toBe(3 - i - 1)
    }
    const denied = consumeRateLimit('tok', 3, t0 + 10)
    expect(denied.allowed).toBe(false)
    expect(denied.remaining).toBe(0)
    expect(denied.retryAfter).toBeGreaterThan(0)
    expect(denied.retryAfter).toBeLessThanOrEqual(60)
    expect(denied.reset).toBe(denied.retryAfter)
  })

  it('windows are independent per token', () => {
    const t0 = 1_000_000_000_000
    consumeRateLimit('tok-a', 1, t0)
    expect(consumeRateLimit('tok-a', 1, t0).allowed).toBe(false)
    expect(consumeRateLimit('tok-b', 1, t0).allowed).toBe(true)
  })

  it('resets when the next window opens', () => {
    const windowStart = Math.floor(1_000_000_000_000 / 60_000) * 60_000
    consumeRateLimit('tok', 1, windowStart)
    expect(consumeRateLimit('tok', 1, windowStart + 1000).allowed).toBe(false)
    expect(consumeRateLimit('tok', 1, windowStart + 60_000).allowed).toBe(true)
  })

  it('evicts counters older than the window (no ever-growing map)', () => {
    const t0 = Math.floor(1_000_000_000_000 / 60_000) * 60_000
    consumeRateLimit('tok-old-1', 10, t0)
    consumeRateLimit('tok-old-2', 10, t0)
    expect(_countersSize()).toBe(2)
    consumeRateLimit('tok-new', 10, t0 + 3 * 60_000)
    expect(_countersSize()).toBe(1)
  })
})
