import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionBinding, ActionCard } from './types'
import { ACTION_CARD_TTL_MS, signCard, verifyCard } from './token'

const bind: ActionBinding = { userId: 'u1', tenantId: 't1', conversationId: 'c1' }

function body(over: Partial<Omit<ActionCard, 'token'>> = {}): Omit<ActionCard, 'token'> {
  return {
    actionId: 'a1',
    kind: 'snapshot',
    tier: 'safe',
    target: { connId: 'k', cluster: 'cl', node: 'n1', vmid: 100, guestKind: 'qemu', name: 'vm' },
    params: { name: 'snap', ram: false },
    preflight: { ok: true, checks: [{ level: 'ok', text: 'fine' }] },
    expiresAt: Date.now() + ACTION_CARD_TTL_MS,
    ...over,
  }
}

describe('action card token', () => {
  const saved = process.env.APP_SECRET

  beforeEach(() => {
    process.env.APP_SECRET = 'test-secret-one'
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_SECRET
    else process.env.APP_SECRET = saved
    vi.useRealTimers()
  })

  it('round-trips', () => {
    expect(verifyCard(signCard(body(), bind), bind)).toEqual({ ok: true })
  })

  it('rejects a changed vmid', () => {
    const c = signCard(body(), bind)
    c.target = { ...c.target, vmid: 101 }
    expect(verifyCard(c, bind)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('rejects a changed param, kind or key order independence holds', () => {
    const c = signCard(body(), bind)
    const reordered = { ...c, params: { ram: false, name: 'snap' }, target: { name: 'vm', guestKind: 'qemu' as const, vmid: 100, node: 'n1', cluster: 'cl', connId: 'k' } }
    expect(verifyCard(reordered, bind)).toEqual({ ok: true })
    expect(verifyCard({ ...c, params: { name: 'x', ram: false } }, bind).ok).toBe(false)
    expect(verifyCard({ ...c, kind: 'start' }, bind).ok).toBe(false)
  })

  it('rejects another user, tenant or conversation', () => {
    const c = signCard(body(), bind)
    for (const b of [{ ...bind, userId: 'u2' }, { ...bind, tenantId: 't2' }, { ...bind, conversationId: 'c2' }]) {
      expect(verifyCard(c, b)).toEqual({ ok: false, reason: 'bad-signature' })
    }
  })

  it('ignores preflight', () => {
    const c = signCard(body(), bind)
    expect(verifyCard({ ...c, preflight: { ok: false, checks: [] } }, bind)).toEqual({ ok: true })
  })

  it('reports expired after a valid signature', () => {
    const c = signCard(body({ expiresAt: Date.now() - 1 }), bind)
    expect(verifyCard(c, bind)).toEqual({ ok: false, reason: 'expired' })
    const other = { ...c, expiresAt: Date.now() + 10_000 }
    expect(verifyCard(other, bind)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('rejects a different secret', () => {
    const c = signCard(body(), bind)
    process.env.APP_SECRET = 'test-secret-two'
    expect(verifyCard(c, bind)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('never throws on malformed cards', () => {
    const bad = ['', null, undefined, 42, 'x'.repeat(5)]
    for (const token of bad) {
      expect(verifyCard({ ...signCard(body(), bind), token } as unknown as ActionCard, bind)).toEqual({ ok: false, reason: 'bad-signature' })
    }
    expect(verifyCard({} as ActionCard, bind)).toEqual({ ok: false, reason: 'bad-signature' })
    expect(verifyCard(null as unknown as ActionCard, bind)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('fails closed without APP_SECRET', () => {
    const c = signCard(body(), bind)
    for (const v of [undefined, '']) {
      if (v === undefined) delete process.env.APP_SECRET
      else process.env.APP_SECRET = v
      expect(() => signCard(body(), bind)).toThrow()
      expect(() => verifyCard(c, bind)).toThrow()
    }
  })
})
