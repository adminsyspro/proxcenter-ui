import { describe, expect, it } from 'vitest'

import { ACTION_CARDS, cardsFromToolResult, collectActionCards } from './cards'
import type { ActionCard, ActionPlan } from './types'

const card = (actionId: string): ActionCard => ({
  actionId,
  kind: 'start',
  tier: 'safe',
  target: { connId: 'c1', cluster: 'PVE-PROD', node: 'pve1', vmid: 101, guestKind: 'qemu', name: 'db-01' },
  params: {},
  preflight: { ok: true, checks: [] },
  expiresAt: Date.now() + 60_000,
  token: 'tok',
})

describe('action cards beside a tool result', () => {
  it('stays out of what the model reads', () => {
    const value: Record<string | symbol, unknown> = { status: 'awaiting-approval', proposed: 'x', checks: [] }

    value[ACTION_CARDS] = { cards: [card('a1')], plans: [] }

    expect(JSON.stringify(value)).not.toContain('tok')
    expect(JSON.stringify(value)).not.toContain('a1')
  })

  it('is read from the two proposal tools only', () => {
    const value: Record<string | symbol, unknown> = {}

    value[ACTION_CARDS] = { cards: [card('a1')], plans: [] }

    expect(cardsFromToolResult('propose_action', value)?.cards).toHaveLength(1)
    expect(cardsFromToolResult('propose_remediation_plan', value)?.cards).toHaveLength(1)
    expect(cardsFromToolResult('list_guests', value)).toBeNull()
    expect(cardsFromToolResult('propose_action', { cards: [card('a1')] })).toBeNull()
    expect(cardsFromToolResult('propose_action', null)).toBeNull()
  })

  it('collects every card and plan of an answer once', () => {
    const plan: ActionPlan = { planId: 'p1', finding: 'pending_updates', title: 't', steps: [] }
    const collected = collectActionCards([
      {},
      { actions: { cards: [card('a1')], plans: [] } },
      { actions: { cards: [card('a1'), card('a2')], plans: [plan] } },
      { actions: { cards: [], plans: [plan] } },
    ])

    expect(collected.cards.map(c => c.actionId)).toEqual(['a1', 'a2'])
    expect(collected.plans.map(p => p.planId)).toEqual(['p1'])
  })
})
