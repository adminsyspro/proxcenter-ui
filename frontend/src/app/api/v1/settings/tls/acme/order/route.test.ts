import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level `const` bindings, so the mock
// objects must come from vi.hoisted (same convention as
// src/app/api/v1/settings/tls/route.test.ts) or the factories below read them
// while they are still in the TDZ.
const { guard, settingsLib, renewLib, leaseLib } = vi.hoisted(() => ({
  guard: { requireTlsAdmin: vi.fn() },
  settingsLib: { loadTlsSettings: vi.fn() },
  // isOrderRunning is the real one: what the route does with a stale `pending`
  // row is exactly what these tests are about.
  renewLib: { runAcmeOrder: vi.fn() },
  leaseLib: { withRenewLease: vi.fn() },
}))

vi.mock('@/lib/tls/guard', () => guard)
vi.mock('@/lib/tls/settings', () => settingsLib)
vi.mock('@/lib/tls/renew', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tls/renew')>('@/lib/tls/renew')

  return { ...actual, ...renewLib }
})
// The ceiling isOrderRunning judges staleness against comes from the real
// module, so the two can never drift apart here.
vi.mock('@/lib/tls/lease', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tls/lease')>('@/lib/tls/lease')

  return { ...actual, ...leaseLib }
})

import { DEFAULT_TLS_SETTINGS } from '@/lib/tls/schema'
import { POST } from '@/app/api/v1/settings/tls/acme/order/route'

const postOrder = () => POST(new Request('http://pc.lab/api/v1/settings/tls/acme/order', { method: 'POST' }))

const configured = {
  ...DEFAULT_TLS_SETTINGS,
  enabled: true,
  source: 'acme' as const,
  acme: { ...DEFAULT_TLS_SETTINGS.acme, domains: ['pcx.lab'] },
}

/** A promise this test controls, standing in for an order still in flight. */
function deferred() {
  let resolve!: (value: { ok: boolean }) => void
  const promise = new Promise<{ ok: boolean }>(r => { resolve = r })

  return { promise, resolve }
}

/** The lease granted: runs the work, exactly as the real one does. */
function leaseGranted() {
  leaseLib.withRenewLease.mockImplementation(async (work: any) => {
    await work({ isHeld: () => true, assertHeld: () => {} })

    return true
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  guard.requireTlsAdmin.mockResolvedValue({ denied: null, userId: 'u1', userEmail: 'a@b.c' })
  settingsLib.loadTlsSettings.mockResolvedValue(configured)
  renewLib.runAcmeOrder.mockResolvedValue({ ok: true })
  leaseGranted()
})

describe('POST /api/v1/settings/tls/acme/order', () => {
  it('hands back the guard refusal untouched', async () => {
    guard.requireTlsAdmin.mockResolvedValue({ denied: new Response('no', { status: 403 }) })

    expect((await postOrder()).status).toBe(403)
    expect(renewLib.runAcmeOrder).not.toHaveBeenCalled()
  })

  it('accepts the order with 202 and runs it under the renewal lease', async () => {
    const res = await postOrder()

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toEqual({ accepted: true })
    expect(leaseLib.withRenewLease).toHaveBeenCalled()
    expect(renewLib.runAcmeOrder).toHaveBeenCalledWith('manual', { assertStillEntitled: expect.any(Function) })
  })

  it('refuses a second order while one is genuinely running, with 409', async () => {
    settingsLib.loadTlsSettings.mockResolvedValue({
      ...configured,
      order: {
        status: 'pending', step: 'order',
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        finishedAt: null, message: null,
      },
    })

    const res = await postOrder()

    expect(res.status).toBe(409)
    expect(renewLib.runAcmeOrder).not.toHaveBeenCalled()
  })

  it('reclaims a pending order older than the lease ceiling instead of wedging for ever', async () => {
    // What a restart mid-issuance leaves behind: `pending` persisted, nobody
    // running it, and, before this, no way out but editing the database.
    settingsLib.loadTlsSettings.mockResolvedValue({
      ...configured,
      order: {
        status: 'pending', step: 'order',
        startedAt: new Date(Date.now() - 45 * 60_000).toISOString(),
        finishedAt: null, message: null,
      },
    })

    const res = await postOrder()

    expect(res.status).toBe(202)
    expect(renewLib.runAcmeOrder).toHaveBeenCalled()
  })

  it('refuses with 409 when the lease is held elsewhere, rather than ordering twice', async () => {
    // Two clicks, or a click landing on top of an automatic renewal: the
    // pending check cannot see either, the lease can.
    leaseLib.withRenewLease.mockResolvedValue(false)

    const res = await postOrder()

    expect(res.status).toBe(409)
    expect(renewLib.runAcmeOrder).not.toHaveBeenCalled()
  })

  it('refuses an order with no domain configured, with 400', async () => {
    settingsLib.loadTlsSettings.mockResolvedValue({
      ...configured,
      acme: { ...configured.acme, domains: [] },
    })

    const res = await postOrder()

    expect(res.status).toBe(400)
    expect(renewLib.runAcmeOrder).not.toHaveBeenCalled()
  })

  it('does NOT await the order: an ACME order outruns nginx’s 60s cut', async () => {
    // The property this route exists for. runAcmeOrder is left hanging, and
    // the response still has to come back. If someone ever adds an `await`,
    // this test stops resolving and fails on the timeout rather than passing
    // quietly — which is the point of hanging it rather than resolving it.
    const order = deferred()

    renewLib.runAcmeOrder.mockReturnValue(order.promise)

    const res = await postOrder()

    expect(res.status).toBe(202)
    expect(renewLib.runAcmeOrder).toHaveBeenCalledWith('manual', expect.any(Object))

    // Let the dangling order finish so it cannot leak into a later test.
    order.resolve({ ok: true })
    await order.promise
  })

  it('a rejected background order never reaches the caller as a 500', async () => {
    // The route catches it for the logs; the UI learns about it by polling
    // GET /api/v1/settings/tls and reading settings.order. The claim has
    // already been answered by then, so the response is long gone.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renewLib.runAcmeOrder.mockRejectedValue(new Error('the CA is unreachable'))

    expect((await postOrder()).status).toBe(202)

    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
