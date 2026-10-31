/**
 * Action cards beside a tool result (roadmap#188).
 *
 * Same mechanism as the charts (`CHART_SERIES` in `@/lib/ai/charts`): the
 * proposal tools put their signed cards under a symbol key, which
 * `JSON.stringify` skips, so the model reads a one-line summary and never the
 * card, its token or anything it could copy into an answer. The loop lifts the
 * cards from the raw result into the trace and the widget renders them.
 *
 * Pure module: no Next, Prisma or React import belongs here.
 */

import type { ActionCard, ActionPlan } from './types'

export const ACTION_CARDS = Symbol('actionCards')

export type ActionCardsPayload = { cards: ActionCard[]; plans: ActionPlan[] }

/** The only tools allowed to produce cards: a card from any other result is ignored. */
const PROPOSAL_TOOLS = new Set(['propose_action', 'propose_remediation_plan'])

const isRecord = (value: unknown): value is Record<string | symbol, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The cards and plans a tool result carries, or null when it carries none. */
export function cardsFromToolResult(toolName: string, value: unknown): ActionCardsPayload | null {
  if (!PROPOSAL_TOOLS.has(toolName) || !isRecord(value)) return null

  const payload = value[ACTION_CARDS]

  if (!isRecord(payload)) return null

  const cards = Array.isArray(payload.cards) ? (payload.cards as ActionCard[]) : []
  const plans = Array.isArray(payload.plans) ? (payload.plans as ActionPlan[]) : []

  return cards.length || plans.length ? { cards, plans } : null
}

/** Every card and plan of one answer, once each, in the order they were proposed. */
export function collectActionCards(trace: ReadonlyArray<{ actions?: ActionCardsPayload }>): ActionCardsPayload {
  const cards = new Map<string, ActionCard>()
  const plans = new Map<string, ActionPlan>()

  for (const entry of trace) {
    for (const card of entry.actions?.cards ?? []) if (!cards.has(card.actionId)) cards.set(card.actionId, card)
    for (const plan of entry.actions?.plans ?? []) if (!plans.has(plan.planId)) plans.set(plan.planId, plan)
  }

  return { cards: [...cards.values()], plans: [...plans.values()] }
}
