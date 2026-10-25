import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level `const` bindings, so the
// mock objects themselves must come from vi.hoisted (same convention as
// src/lib/tls/store.test.ts and src/lib/tls/settings.test.ts) or the
// factories below read these bindings while they are still in the TDZ.
const { bootstrap, renew, challenges, store, settings, lease } = vi.hoisted(() => {
  const bootstrap = { applyActiveCertificate: vi.fn(async () => 'unchanged') }
  const renew = { runAcmeOrder: vi.fn(async () => ({ ok: true })), shouldRenew: vi.fn(() => false) }
  const challenges = { purgeExpiredChallenges: vi.fn(async () => 0) }
  const store = { getActiveSummary: vi.fn(async () => null) }
  const settings = { loadTlsSettings: vi.fn() }

  // The lease itself is exercised against a real Postgres in lease.test.ts;
  // here only the gating matters — did the tick run the order or not.
  const lease = { withRenewLease: vi.fn<(work: (lease: any) => Promise<void>) => Promise<boolean>>() }

  return { bootstrap, renew, challenges, store, settings, lease }
})

vi.mock('@/lib/tls/bootstrap', () => bootstrap)
vi.mock('@/lib/tls/renew', () => renew)
vi.mock('@/lib/tls/challengeStore', () => challenges)
vi.mock('@/lib/tls/store', () => store)
vi.mock('@/lib/tls/settings', () => settings)
vi.mock('@/lib/tls/lease', () => lease)

import { DEFAULT_TLS_SETTINGS } from '@/lib/tls/schema'
import { startTlsReconciler } from '@/lib/tls/reconciler'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  settings.loadTlsSettings.mockResolvedValue({ ...DEFAULT_TLS_SETTINGS, enabled: true })

  // Re-armed here rather than at vi.fn() creation: clearAllMocks() wipes call
  // history but not implementations, so a test that overrides this would
  // otherwise leak its override into every test that follows.
  // The real one passes the work a handle it can consult before publishing;
  // the default here says "still held", and one case below says otherwise.
  lease.withRenewLease.mockImplementation(async work => {
    await work({ isHeld: () => true, assertHeld: () => {} })

    return true
  })
})

afterEach(() => vi.useRealTimers())

describe('startTlsReconciler', () => {
  it('reconciles the listener on every tick', async () => {
    const stop = startTlsReconciler({ intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(2500)

    expect(bootstrap.applyActiveCertificate.mock.calls.length).toBeGreaterThanOrEqual(2)
    stop()
  })

  it('orders a renewal only when shouldRenew says so', async () => {
    renew.shouldRenew.mockReturnValue(true)

    const stop = startTlsReconciler({ intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(1100)

    expect(renew.runAcmeOrder).toHaveBeenCalledWith('renewal', expect.objectContaining({
      assertStillEntitled: expect.any(Function),
    }))
    stop()
  })

  it('orders under the renewal lease, so one replica orders', async () => {
    renew.shouldRenew.mockReturnValue(true)

    const stop = startTlsReconciler({ intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(1100)

    expect(lease.withRenewLease).toHaveBeenCalled()
    stop()
  })

  it('does not apply a certificate it lost the lease for mid-order', async () => {
    renew.shouldRenew.mockReturnValue(true)
    lease.withRenewLease.mockImplementation(async work => {
      // The lease went to a neighbour while the order was in flight.
      await work({
        isHeld: () => false,
        assertHeld: () => { throw new Error('lease lost') },
      }).catch(() => {})

      return true
    })

    // One tick only, so the call count below is unambiguous: the interval is
    // longer than the window advanced, leaving just the immediate tick.
    const stop = startTlsReconciler({ intervalMs: 100_000 })

    await vi.advanceTimersByTimeAsync(10)

    // Exactly one call: the reconcile at the top of the tick. A second would
    // be the post-publish apply, which a replica that lost the lease must not
    // reach — the order itself is fenced by the same handle inside
    // runAcmeOrder.
    expect(bootstrap.applyActiveCertificate).toHaveBeenCalledTimes(1)
    expect(renew.runAcmeOrder).toHaveBeenCalledWith('renewal', expect.objectContaining({
      assertStillEntitled: expect.any(Function),
    }))
    stop()
  })

  it('applies the new certificate when the lease was held throughout', async () => {
    renew.shouldRenew.mockReturnValue(true)

    const stop = startTlsReconciler({ intervalMs: 100_000 })

    await vi.advanceTimersByTimeAsync(10)

    // Twice: the reconcile at the top, then the publish after a successful order.
    expect(bootstrap.applyActiveCertificate).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does not order when another replica holds the lease', async () => {
    renew.shouldRenew.mockReturnValue(true)
    lease.withRenewLease.mockImplementation(async () => false)

    const stop = startTlsReconciler({ intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(1100)

    expect(renew.runAcmeOrder).not.toHaveBeenCalled()
    stop()
  })

  it('survives a tick that throws', async () => {
    bootstrap.applyActiveCertificate.mockRejectedValueOnce(new Error('boom'))

    const stop = startTlsReconciler({ intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(2100)

    expect(bootstrap.applyActiveCertificate.mock.calls.length).toBeGreaterThanOrEqual(2)
    stop()
  })

  it('stops for good once stopped', async () => {
    const stop = startTlsReconciler({ intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(1100)
    const seen = bootstrap.applyActiveCertificate.mock.calls.length

    stop()
    await vi.advanceTimersByTimeAsync(5000)

    expect(bootstrap.applyActiveCertificate.mock.calls.length).toBe(seen)
  })
})
