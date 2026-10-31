// Server only (node:crypto). Signs the action cards the assistant proposes so
// the execute route can tell a card this server issued, to this user, in this
// conversation, unaltered and unexpired, from anything the browser forged.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

import type { ActionBinding, ActionCard } from './types'

export const ACTION_CARD_TTL_MS = 15 * 60 * 1000

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

// `token` is the signature itself and `preflight` is display data recomputed at
// execution, so neither is covered.
function mac(card: Record<string, unknown>, bind: ActionBinding): Buffer {
  const { token: _token, preflight: _preflight, ...signed } = card
  const payload = canonical({
    card: signed,
    bind: { userId: bind?.userId, tenantId: bind?.tenantId, conversationId: bind?.conversationId },
  })
  return createHmac('sha256', getKey()).update(payload).digest()
}

export function signCard(body: Omit<ActionCard, 'token'>, bind: ActionBinding): ActionCard {
  return { ...body, token: mac(body as Record<string, unknown>, bind).toString('base64url') }
}

export function verifyCard(
  card: ActionCard,
  bind: ActionBinding,
): { ok: true } | { ok: false; reason: 'bad-signature' | 'expired' } {
  const expected = mac(card && typeof card === 'object' ? (card as Record<string, unknown>) : {}, bind)

  const token = card && typeof card === 'object' ? card.token : undefined
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
