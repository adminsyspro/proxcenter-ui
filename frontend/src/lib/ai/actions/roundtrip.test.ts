/**
 * A card survives the trip the widget makes it take (roadmap#188): signed by
 * the proposal tool, encoded in the `actions` frame, decoded and sanitised by
 * the browser, then verified by the execute route. Every field the sanitiser
 * rebuilds must come out exactly as it was signed, or the card fails
 * `bad-signature` at the click.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createFrameDecoder, encodeFrame, type StreamFrame } from '@/lib/ai/streamFrames'

import { sanitizeActionCard } from './cards'
import { issueCard, type ActionsContext } from './propose'
import { verifyCard } from './token'
import { ACTION_KINDS, actionTier, normalizeAiActionsSettings, type ActionCard, type ActionKind, type ActionPlan } from './types'

const bind = { userId: 'u1', tenantId: 't1', conversationId: 'conv-1' }

const actions: ActionsContext = {
  settings: normalizeAiActionsSettings({ enabled: true, actions: Object.fromEntries(ACTION_KINDS.map(k => [k, true])) }),
  bind,
  visibleText: '',
  userText: '',
}

const PARAMS: Record<ActionKind, ActionCard['params']> = {
  snapshot: { name: 'ai-20261031-1405' },
  start: {},
  migrate: { target: 'pve3', online: true },
  drs_apply: { recommendationId: '42' },
  backup_add: { jobId: 'backup-nightly' },
  shutdown: {},
  reboot: {},
  maintenance: { mode: 'enter' },
}

function targetOf(kind: ActionKind, guestKind: 'qemu' | 'lxc'): ActionCard['target'] {
  if (kind === 'maintenance') return { connId: 'c1', cluster: 'PVE-PROD', node: 'pve2', name: 'pve2' }

  return { connId: 'c1', cluster: 'PVE-PROD', node: 'pve1', vmid: guestKind === 'lxc' ? 205 : 104, guestKind, name: guestKind === 'lxc' ? 'ct-web' : 'win2025' }
}

function issue(kind: ActionKind, guestKind: 'qemu' | 'lxc', plan?: { planId: string; step: number; after?: number }): ActionCard {
  return issueCard(actions, {
    kind,
    target: targetOf(kind, guestKind),
    params: PARAMS[kind],
    preflight: { ok: true, checks: [{ level: 'warn', text: 'shown on the card' }] },
    ...plan,
  })
}

/** What the widget holds after reading the frame off the stream. */
function throughTheStream(frame: StreamFrame): Extract<StreamFrame, { type: 'actions' }> {
  const decoder = createFrameDecoder()
  const encoded = `Here is the card.${encodeFrame(frame)}`
  // Split anywhere, as the network does.
  const cut = Math.floor(encoded.length / 2)
  const frames = [...decoder.push(encoded.slice(0, cut)).frames, ...decoder.push(encoded.slice(cut)).frames]
  const decoded = frames.find(f => f.type === 'actions')

  if (decoded?.type !== 'actions') throw new Error('no actions frame decoded')

  return decoded
}

const CASES = ACTION_KINDS.flatMap(kind => (['qemu', 'lxc'] as const).map(guestKind => [kind, guestKind] as const))

beforeAll(() => {
  process.env.APP_SECRET = 'roundtrip-test-secret'
})
afterAll(() => {
  delete process.env.APP_SECRET
})

describe('card round trip, propose to frame to execute', () => {
  it.each(CASES)('a loose %s card on a %s verifies after decoding', (kind, guestKind) => {
    const card = issue(kind, guestKind)
    const decoded = throughTheStream({ type: 'actions', cards: [card], plans: [] }).cards[0]

    expect(decoded).toEqual(card)
    expect(verifyCard(decoded, bind)).toEqual({ ok: true })
  })

  it.each(CASES)('a %s plan step on a %s verifies after decoding', (kind, guestKind) => {
    const first = issue(kind, guestKind, { planId: 'p1', step: 1 })
    const second = issue(kind, guestKind, { planId: 'p1', step: 3, after: 1 })
    const plan: ActionPlan = {
      planId: 'p1',
      finding: 'pending_updates',
      title: 'A plan',
      steps: [{ step: 1, card: first }, { step: 2, manual: { text: 'Do it by hand.', href: '/infrastructure/inventory' } }, { step: 3, card: second }],
    }
    const decoded = throughTheStream({ type: 'actions', cards: [], plans: [plan] }).plans[0]

    expect(decoded.steps.map(s => s.card && verifyCard(s.card, bind))).toEqual([{ ok: true }, undefined, { ok: true }])
  })

  it('signs a container migration disruptive, and the decoder derives the same tier', () => {
    const card = issue('migrate', 'lxc')

    expect(card.tier).toBe('disruptive')
    expect(issue('migrate', 'qemu').tier).toBe('safe')
    expect(sanitizeActionCard(JSON.parse(JSON.stringify(card)))?.tier).toBe('disruptive')
  })

  it('cannot lower a tier on the way: the decoder rebuilds it from the kind and target', () => {
    const card = issue('migrate', 'lxc')
    const forged = sanitizeActionCard({ ...JSON.parse(JSON.stringify(card)), tier: 'safe' })

    expect(forged?.tier).toBe('disruptive')
    expect(verifyCard(forged!, bind)).toEqual({ ok: true })
  })

  it.each(CASES)('actionTier agrees with the tier signed on a %s card on a %s', (kind, guestKind) => {
    const card = issue(kind, guestKind)

    expect(actionTier(card.kind, card.target)).toBe(card.tier)
  })
})

describe('a decoded card altered before execute', () => {
  const base = () => {
    const card = issue('migrate', 'lxc', { planId: 'p1', step: 3, after: 1 })

    return throughTheStream({ type: 'actions', cards: [card], plans: [] }).cards[0]
  }

  const TAMPERS: Array<[string, (c: ActionCard) => ActionCard]> = [
    ['tier', c => ({ ...c, tier: c.tier === 'safe' ? 'disruptive' : 'safe' })],
    ['planId', c => ({ ...c, planId: 'p2' })],
    ['planId removed', c => ({ ...c, planId: undefined })],
    ['step', c => ({ ...c, step: 4 })],
    ['after', c => ({ ...c, after: 2 })],
    ['after removed', c => ({ ...c, after: undefined })],
    ['target.node', c => ({ ...c, target: { ...c.target, node: 'pve2' } })],
    ['target.vmid', c => ({ ...c, target: { ...c.target, vmid: 206 } })],
    ['target.guestKind', c => ({ ...c, target: { ...c.target, guestKind: 'qemu' } })],
    ['params.target', c => ({ ...c, params: { ...c.params, target: 'pve2' } })],
    ['params added', c => ({ ...c, params: { ...c.params, force: true } })],
    ['expiresAt', c => ({ ...c, expiresAt: c.expiresAt + 60_000 })],
  ]

  it('verifies untouched', () => {
    expect(verifyCard(base(), bind)).toEqual({ ok: true })
  })

  it.each(TAMPERS)('fails bad-signature when %s changes', (_field, tamper) => {
    expect(verifyCard(tamper(base()), bind)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('ignores the preflight, display data recomputed at execution', () => {
    expect(verifyCard({ ...base(), preflight: { ok: false, checks: [] } }, bind)).toEqual({ ok: true })
  })
})
