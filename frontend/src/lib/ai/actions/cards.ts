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

import { ACTION_KINDS, actionTier, type ActionCard, type ActionPlan } from './types'

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

// ---------------------------------------------------------------------------
// Decoder side: what the browser keeps of a card read off the stream. Only the
// fields of the type, with the right primitive types; the signature is checked
// by the server when the card is executed, not here.
// ---------------------------------------------------------------------------

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** A manual step may only link inside the app: one leading slash, no scheme, no backslash. */
export const isRelativeAppPath = (href: string): boolean =>
  href.startsWith('/') && !href.startsWith('//') && !href.includes('\\') && !/[\u0000-\u001f]/.test(href)

const FINDINGS: ActionPlan['finding'][] = ['unprotected_guests', 'host_memory', 'pending_updates']

/** A card read back from the stream, or null when it is not one. */
export function sanitizeActionCard(raw: unknown): ActionCard | null {
  if (!isRecord(raw)) return null

  const kind = ACTION_KINDS.find(k => k === raw.kind)
  const target = isRecord(raw.target) ? raw.target : null
  const actionId = str(raw.actionId)
  const token = str(raw.token)
  const expiresAt = num(raw.expiresAt)

  if (!kind || !target || !actionId || !token || expiresAt === undefined) return null

  const connId = str(target.connId)
  const cluster = str(target.cluster)
  const node = str(target.node)
  const name = str(target.name)

  if (connId === undefined || cluster === undefined || node === undefined || name === undefined) return null

  const params: ActionCard['params'] = {}

  if (isRecord(raw.params)) {
    for (const [k, v] of Object.entries(raw.params)) {
      if (typeof v === 'string' || typeof v === 'boolean' || num(v) !== undefined) params[k] = v as string | number | boolean
    }
  }

  const preflight = isRecord(raw.preflight) ? raw.preflight : {}
  const checks: ActionCard['preflight']['checks'] = []

  for (const c of Array.isArray(preflight.checks) ? preflight.checks : []) {
    const level = isRecord(c) ? (['ok', 'warn', 'block'] as const).find(l => l === c.level) : undefined

    if (level && isRecord(c) && typeof c.text === 'string') checks.push({ level, text: c.text })
  }

  const vmid = num(target.vmid)
  const guestKind = target.guestKind === 'qemu' || target.guestKind === 'lxc' ? target.guestKind : undefined
  const planId = str(raw.planId)
  const step = num(raw.step)
  const after = num(raw.after)
  const cleanTarget: ActionCard['target'] = { connId, cluster, node, name, ...(vmid !== undefined ? { vmid } : {}), ...(guestKind ? { guestKind } : {}) }

  return {
    actionId,
    kind,
    // Derived, never trusted: the tier decides how many confirmations the
    // widget asks for. Derived exactly as the signer did (`actionTier`), or
    // a container migration card would fail its signature at the click.
    tier: actionTier(kind, cleanTarget),
    target: cleanTarget,
    params,
    preflight: { ok: preflight.ok === true, checks },
    ...(planId !== undefined ? { planId } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(after !== undefined ? { after } : {}),
    expiresAt,
    token,
  }
}

/** A plan read back from the stream. A step whose card is malformed loses the card, not the step. */
export function sanitizeActionPlan(raw: unknown): ActionPlan | null {
  if (!isRecord(raw)) return null

  const planId = str(raw.planId)
  const title = str(raw.title)
  const finding = FINDINGS.find(f => f === raw.finding)

  if (!planId || title === undefined || !finding || !Array.isArray(raw.steps)) return null

  const steps: ActionPlan['steps'] = []

  for (const s of raw.steps) {
    const step = isRecord(s) ? num(s.step) : undefined

    if (!isRecord(s) || step === undefined) continue

    const card = s.card === undefined ? null : sanitizeActionCard(s.card)
    const manualText = isRecord(s.manual) ? str(s.manual.text) : undefined
    const manualHref = isRecord(s.manual) ? str(s.manual.href) : undefined
    const manual = manualText !== undefined
      ? { text: manualText, href: manualHref !== undefined && isRelativeAppPath(manualHref) ? manualHref : '' }
      : undefined

    steps.push({ step, ...(card ? { card } : {}), ...(manual ? { manual } : {}) })
  }

  return { planId, finding, title, steps }
}
