/**
 * What the two proposal tools share (roadmap#188): the gate, the per-question
 * budget, card issuing and the result the model reads.
 *
 * Server only (signs with node:crypto).
 */

import { randomUUID } from 'node:crypto'

import { planAddGuestToJob, type VzdumpJob } from '@/lib/backups/coverage'
import { ToolArgumentError, ToolScopeError, type ToolContext } from '@/lib/tools/types'

import { ACTION_CARDS, type ActionCardsPayload } from './cards'
import { actionTier } from './target'
import { ACTION_CARD_TTL_MS, signCard } from './token'
import type { ActionCard } from './types'

/** Proposals per question, a plan counting for one: bounds the precondition reads. */
export const MAX_PROPOSALS_PER_QUESTION = 3

export type ActionsContext = NonNullable<ToolContext['actions']>

export function requireActions(ctx: ToolContext): ActionsContext {
  if (!ctx.actions) throw new ToolScopeError('Actions are not enabled.')

  return ctx.actions
}

export function assertProposalBudget(ctx: ToolContext) {
  if ((ctx.usage?.proposals ?? 0) >= MAX_PROPOSALS_PER_QUESTION) {
    throw new ToolScopeError(
      `At most ${MAX_PROPOSALS_PER_QUESTION} actions can be proposed per question: answer with the cards already proposed.`
    )
  }
}

/** Spends one proposal; the check runs again so two calls in one round cannot both slip under the cap. */
export function consumeProposal(ctx: ToolContext) {
  assertProposalBudget(ctx)

  const usage = (ctx.usage ??= { historyLookups: 0 })

  usage.proposals = (usage.proposals ?? 0) + 1
}

/** A required enum argument, refused with the accepted values when missing or unknown. */
export function argRequiredEnum<T extends string>(args: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const raw = typeof args?.[key] === 'string' ? (args[key] as string).trim().toLowerCase() : ''

  if ((allowed as readonly string[]).includes(raw)) return raw as T

  throw new ToolArgumentError(
    raw
      ? `Invalid value "${raw}" for "${key}". Accepted values: ${allowed.join(', ')}.`
      : `Pass "${key}", one of: ${allowed.join(', ')}.`
  )
}

export function issueCard(
  actions: ActionsContext,
  body: Pick<ActionCard, 'kind' | 'target' | 'params' | 'preflight'> & { planId?: string; step?: number }
): ActionCard {
  return signCard(
    {
      actionId: randomUUID(),
      kind: body.kind,
      tier: actionTier(body.kind, body.target),
      target: body.target,
      params: body.params,
      preflight: body.preflight,
      ...(body.planId ? { planId: body.planId, step: body.step } : {}),
      expiresAt: Date.now() + ACTION_CARD_TTL_MS,
    },
    actions.bind
  )
}

/** "reboot win2025 (104) on pve1", the words the model and the audit read. */
export function describeCard(card: Pick<ActionCard, 'kind' | 'target' | 'params'>): string {
  const t = card.target
  const guest = t.vmid === undefined ? t.name : `${t.name} (${t.vmid})`

  switch (card.kind) {
    case 'migrate':
      return `migrate ${guest} from ${t.node} to ${String(card.params.target)}`
    case 'drs_apply':
      return `apply the DRS move of ${guest} on ${t.node}`
    case 'backup_add':
      return `add ${guest} to backup job ${String(card.params.jobId)}`
    case 'snapshot':
      return `snapshot ${guest} on ${t.node} as "${String(card.params.name)}"`
    case 'maintenance':
      return `${card.params.mode === 'exit' ? 'take' : 'put'} ${t.name} ${card.params.mode === 'exit' ? 'out of' : 'in'} maintenance`
    default:
      return `${card.kind} ${guest} on ${t.node}`
  }
}

/**
 * The result handed back: the model reads a one-line summary and the checks;
 * the signed cards sit under a symbol key `JSON.stringify` skips.
 */
export function proposalResult(
  payload: ActionCardsPayload,
  summary: { status: 'awaiting-approval' | 'blocked' | 'nothing-to-do'; proposed: string; checks: ActionCard['preflight']['checks'] }
): Record<string | symbol, unknown> {
  const result: Record<string | symbol, unknown> = { ...summary }

  result[ACTION_CARDS] = payload

  return result
}

export function cardResult(card: ActionCard) {
  const firstBlock = card.preflight.checks.find(c => c.level === 'block')

  return proposalResult(
    { cards: [card], plans: [] },
    firstBlock
      ? { status: 'blocked', proposed: `Proposed: ${describeCard(card)}, blocked: ${firstBlock.text}`, checks: card.preflight.checks }
      : { status: 'awaiting-approval', proposed: `Proposed: ${describeCard(card)}, waiting for the user's approval`, checks: card.preflight.checks }
  )
}

/** The job a guest joins: an enabled compatible one first, else any compatible one. */
export function firstCompatibleJob(jobs: VzdumpJob[], guest: { vmid: string; node: string }): VzdumpJob | undefined {
  const compatible = jobs.filter(j => j.id).map(job => ({ job, plan: planAddGuestToJob(job, guest) }))
  const enabled = compatible.find(c => c.plan.ok && !c.plan.disabled)

  return (enabled ?? compatible.find(c => c.plan.ok))?.job
}

/** `ai-YYYYMMDD-HHmm` in the reader's time zone. */
export function defaultSnapshotName(timeZone: string | undefined, now = new Date()): string {
  let parts: Record<string, string>

  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      })
        .formatToParts(now)
        .map(p => [p.type, p.value])
    )
  } catch {
    const iso = now.toISOString()

    parts = { year: iso.slice(0, 4), month: iso.slice(5, 7), day: iso.slice(8, 10), hour: iso.slice(11, 13), minute: iso.slice(14, 16) }
  }

  return `ai-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`
}
