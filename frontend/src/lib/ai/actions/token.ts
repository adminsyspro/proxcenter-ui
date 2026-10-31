// Server only (node:crypto). Signs the action cards the assistant proposes so
// the execute route can tell a card this server issued, to this user, in this
// conversation, unaltered and unexpired, from anything the browser forged.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

import type { ActionBinding, ActionCard } from './types'

export const ACTION_CARD_TTL_MS = 15 * 60 * 1000

/**
 * A plan step is signed when the plan is proposed but runs only after the
 * steps before it: a 5-migration plan, or the exit of a pending_updates plan
 * once the updates are installed by hand, would always outlive 15 minutes.
 * Two hours is safe because nothing about the step is trusted from its
 * proposal: execute replays every check, and an actionId runs once.
 */
export const ACTION_PLAN_CARD_TTL_MS = 2 * 60 * 60 * 1000

let cachedFor: string | null = null
let cachedKey: Buffer | null = null

// Derived once per APP_SECRET value. Fail closed: without a secret nothing is
// signed and nothing verifies. NEXTAUTH_SECRET is deliberately not used.
function getKey(): Buffer {
  const secret = process.env.APP_SECRET
  if (!secret) throw new Error('APP_SECRET is not set: action cards cannot be signed or verified')
  if (cachedKey && cachedFor === secret) return cachedKey
  cachedKey = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'proxcenter-ai-actions/card', 32))
  cachedFor = secret
  return cachedKey
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>
    const parts = Object.keys(o)
      .filter(k => o[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(o[k])}`)
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function validBinding(bind: ActionBinding): boolean {
  if (!bind || typeof bind !== 'object') return false
  return [bind.userId, bind.tenantId, bind.conversationId].every(v => typeof v === 'string' && v.length > 0)
}

// `token` is the signature itself and `preflight` is display data recomputed at
// execution, so neither is covered. The binding must be complete: a missing or
// empty field would silently weaken it and let two callers share cards.
function mac(card: Record<string, unknown>, bind: ActionBinding): Buffer {
  const key = getKey()
  const { token: _token, preflight: _preflight, ...signed } = card
  const payload = canonical({
    card: signed,
    bind: { userId: bind.userId, tenantId: bind.tenantId, conversationId: bind.conversationId },
  })
  return createHmac('sha256', key).update(payload).digest()
}

export function signCard(body: Omit<ActionCard, 'token'>, bind: ActionBinding): ActionCard {
  getKey()
  if (!validBinding(bind)) throw new Error('Action card binding needs a non-empty userId, tenantId and conversationId')
  return { ...body, token: mac(body as Record<string, unknown>, bind).toString('base64url') }
}

export function verifyCard(
  card: ActionCard,
  bind: ActionBinding,
): { ok: true } | { ok: false; reason: 'bad-signature' | 'expired' } {
  getKey() // a missing APP_SECRET is the only thing that throws
  if (!validBinding(bind) || !card || typeof card !== 'object') return { ok: false, reason: 'bad-signature' }

  let expected: Buffer
  try {
    expected = mac(card as Record<string, unknown>, bind)
  } catch {
    return { ok: false, reason: 'bad-signature' }
  }

  const token = card.token
  if (typeof token !== 'string' || token.length === 0) return { ok: false, reason: 'bad-signature' }

  const given = Buffer.from(token, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad-signature' }
  }

  if (typeof card.expiresAt !== 'number' || !(card.expiresAt > Date.now())) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true }
}
