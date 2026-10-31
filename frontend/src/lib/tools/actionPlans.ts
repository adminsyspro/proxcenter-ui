/**
 * Remediation plans of the assistant (roadmap#188): a finding turned into at
 * most ten signed cards the user runs one step at a time, and never more
 * cards than the conversation may still execute (`maxPerConversation`): a
 * step past the cap would be refused at every click. One plan per question.
 *
 * The steps come from the code, never from the model: the backup coverage
 * resolver picks the unprotected guests, the RAM arithmetic of
 * simulate_migration picks what moves where, the maintenance state decides
 * the update sequence. Only the host or cluster the finding is about must be
 * grounded in the conversation; the guests a plan names were chosen here.
 *
 * Proxmox load: a host_memory plan runs the full migrate preflight on at most
 * MAX_PLAN_MIGRATION_CHECKS candidates, one after the other (at most 5
 * protected GETs); the other plans read no precondition, and the backup jobs
 * and the pending update list come from the caches the read-only tools fill.
 * Every preflight read goes through the question's chain (`serialPveRead`), so
 * a plan and a propose_action of the same round never overlap either.
 */

import { randomUUID } from 'node:crypto'

import { assertClusterGrounded, assertTargetGrounded } from '@/lib/ai/actions/grounding'
import { preflightAction } from '@/lib/ai/actions/preflight'
import {
  argRequiredEnum,
  assertProposalBudget,
  consumeProposal,
  firstCompatibleJob,
  issueCard,
  proposalResult,
  requireActions,
  reservePlan,
  type ActionsContext,
} from '@/lib/ai/actions/propose'
import { guestTarget, hostTarget } from '@/lib/ai/actions/target'
import { enabledKinds, type ActionCard, type ActionKind, type ActionPlan } from '@/lib/ai/actions/types'
import { PERMISSIONS } from '@/lib/rbac'
import { getAllowedJobPools } from '@/lib/vdc/backupJobs'

import { computeBackupCoverage } from './backups'
import { evaluateHostFit } from './forecast'
import { hasNodePermission } from './guards'
import { readPendingUpdates } from './hosts'
import type { SnapshotNode } from './snapshot'
import { argString, resolveConnection, resolveNode, ToolArgumentError, ToolScopeError, type CatalogTool, type ToolContext } from './types'

export type PlanFinding = ActionPlan['finding']

export const PLAN_FINDINGS: readonly PlanFinding[] = ['unprotected_guests', 'host_memory', 'pending_updates']

/** The action kind each finding's steps use: the finding is offered only when that kind is enabled. */
export const FINDING_KIND: Record<PlanFinding, ActionKind> = {
  unprotected_guests: 'backup_add',
  host_memory: 'migrate',
  pending_updates: 'maintenance',
}

export const MAX_PLAN_STEPS = 10

/** A host_memory plan moves guests until the host would be back under this RAM use. */
export const HOST_MEMORY_TARGET_PCT = 75

/**
 * Candidates of a host_memory plan checked with Proxmox, one after the other:
 * each is the full migrate preflight, so one protected precondition GET (plus,
 * for a container, its config and the cached storage config, not protected). At
 * most 5 protected GETs per plan question, and the plan never offers a move
 * Proxmox or the local-storage rule would refuse at click time (R10).
 */
export const MAX_PLAN_MIGRATION_CHECKS = 5

type Step = ActionPlan['steps'][number]

type Check = ActionCard['preflight']['checks'][number]

/** `notes` reach the model as checks: why a candidate was left out of the plan. */
type Built = { title: string; steps: Step[]; summary?: string; notes?: Check[] } | { nothing: string; notes?: Check[] }

const r1 = (v: number) => Math.round(v * 10) / 10

/**
 * Card steps one plan may carry: the conversation's execution cap, within
 * MAX_PLAN_STEPS. The default cap is 5, so a 10-step plan would leave steps 6
 * to 10 refused (429) at every click.
 */
export function planCardLimit(actions: ActionsContext): number {
  return Math.max(1, Math.min(MAX_PLAN_STEPS, actions.settings.maxPerConversation))
}

const cardCount = (steps: Step[]) => steps.filter(s => s.card).length

const laterNote = (n: number) => `${n} more left for a later conversation`

/** The step of the last card already in the plan: the one a new card waits for (R12). */
function previousCardStep(steps: Step[]): number | undefined {
  return steps.findLast(s => s.card)?.step
}

async function stepCard(
  actions: ActionsContext,
  ctx: ToolContext,
  planId: string,
  steps: Step[],
  body: Pick<ActionCard, 'kind' | 'target' | 'params'>
): Promise<Step> {
  const step = steps.length + 1
  const preflight = await preflightAction(body, ctx, { inPlan: true })

  return { step, card: issueCard(actions, { ...body, preflight, planId, step, after: previousCardStep(steps) }) }
}

/** `userOnly`: the plan's cards act on this host and are disruptive (maintenance), see `assertTargetGrounded`. */
function groundedHost(args: Record<string, unknown>, ctx: ToolContext, actions: ActionsContext, opts: { userOnly?: boolean } = {}): SnapshotNode {
  const host = argString(args, 'host')

  if (!host) throw new ToolArgumentError('Pass host: the host the finding is about.')

  assertClusterGrounded(actions, ctx, argString(args, 'cluster'))

  const { node } = resolveNode(ctx, host, argString(args, 'cluster'))

  assertTargetGrounded(actions, hostTarget(node), opts)

  return node
}

async function unprotectedGuests(args: Record<string, unknown>, ctx: ToolContext, actions: ActionsContext, planId: string): Promise<Built> {
  const clusterRef = argString(args, 'cluster')

  assertClusterGrounded(actions, ctx, clusterRef)

  const scope = clusterRef ? [resolveConnection(ctx, clusterRef)] : ctx.snapshot.clusters.map(c => ({ id: c.id, name: c.name }))


  // The add-to-job route refuses a vDC tenant: their jobs follow their pools.
  const allowed = []

  for (const c of scope) if ((await getAllowedJobPools(ctx.tenantId, c.id)) === null) allowed.push(c)

  if (allowed.length === 0) throw new ToolScopeError('Adding guests to backup jobs is not available to a vDC tenant: your backup jobs follow your pools.')

  consumeProposal(ctx)

  const { uncovered, jobsByConnection } = await computeBackupCoverage(ctx, allowed)
  const limit = planCardLimit(actions)
  const steps: Step[] = []
  let noJob = 0

  for (const u of uncovered) {
    if (steps.length >= limit) break

    const guest = ctx.snapshot.guests.find(g => g.connId === u.connId && g.vmid === u.vmid)
    const job = firstCompatibleJob(jobsByConnection[u.connId] ?? [], { vmid: u.vmid, node: u.node })

    if (!guest || !job?.id) {
      noJob++
      continue
    }

    steps.push(await stepCard(actions, ctx, planId, steps, { kind: 'backup_add', target: guestTarget(guest), params: { jobId: job.id } }))
  }

  if (steps.length === 0) {
    return { nothing: uncovered.length ? `None of the ${uncovered.length} unprotected guests fits an existing backup job: create a job from the Backups page.` : 'Every guest is protected by a backup job.' }
  }

  const left = uncovered.length - steps.length - noJob

  return {
    title: `Add ${steps.length} unprotected guests to existing backup jobs`,
    steps,
    summary: `${uncovered.length} unprotected, ${steps.length} in this plan${left > 0 ? `, ${laterNote(left)}` : ''}${noJob ? `, ${noJob} with no compatible job` : ''}`,
  }
}

/** Why a candidate was dropped, in two words for the summary. */
function skipReason(text: string): string {
  if (text.includes('local storage')) return 'local storage'
  if (text.includes('tied to its host')) return 'host-bound resources'

  return 'refused by the preflight'
}

async function hostMemory(args: Record<string, unknown>, ctx: ToolContext, actions: ActionsContext, planId: string): Promise<Built> {
  const host = groundedHost(args, ctx, actions)

  consumeProposal(ctx)

  if (host.memPct <= HOST_MEMORY_TARGET_PCT) return { nothing: `${host.name} uses ${host.memPct} % of its RAM, under ${HOST_MEMORY_TARGET_PCT} %: nothing to relieve.` }

  // What the plan already sends to each host, so two steps never count the same free RAM.
  const planned = new Map<string, number>()
  const others = ctx.snapshot.nodes.filter(n => n.connId === host.connId && n.name !== host.name && n.status === 'online' && !n.maintenance)
  const movable = ctx.snapshot.guests
    .filter(g => g.connId === host.connId && g.node === host.name && g.status === 'running' && !g.template)
    .sort((a, b) => b.memUsedGb - a.memUsedGb)
  const steps: Step[] = []
  const skipped: Array<{ name: string; text: string }> = []
  const limit = planCardLimit(actions)
  let used = host.memUsedGb
  let checked = 0
  let capped = false

  for (const guest of movable) {
    if ((used / host.memTotalGb) * 100 <= HOST_MEMORY_TARGET_PCT) break
    if (steps.length >= limit) {
      capped = true
      break
    }
    if (steps.length >= MAX_PLAN_STEPS || checked >= MAX_PLAN_MIGRATION_CHECKS) break

    const best = others
      .map(n => evaluateHostFit(ctx.snapshot, guest, { ...n, memUsedGb: n.memUsedGb + (planned.get(n.name) ?? 0) }))
      .filter(fit => fit.fits)
      .sort((a, b) => b.ramFreeAfterReserveGb - a.ramFreeAfterReserveGb)[0]

    if (!best) continue

    const body = { kind: 'migrate' as const, target: guestTarget(guest), params: { target: best.host, online: true } }

    // Sequential on purpose: one protected call in flight at a time.
    checked++
    const preflight = await preflightAction(body, ctx)

    if (!preflight.ok) {
      skipped.push({ name: guest.name, text: preflight.checks.find(c => c.level === 'block')?.text ?? 'refused' })
      continue
    }

    planned.set(best.host, (planned.get(best.host) ?? 0) + guest.memTotalGb)
    used -= guest.memUsedGb

    const step = steps.length + 1

    steps.push({ step, card: issueCard(actions, { ...body, preflight, planId, step, after: previousCardStep(steps) }) })
  }

  const notes: Check[] = skipped.map(s => ({ level: 'warn', text: `Skipped ${s.name}: ${s.text}` }))
  const reasons = [...new Set(skipped.map(s => skipReason(s.text)))].join(', ')
  const skippedNote = skipped.length ? `${skipped.length} guest${skipped.length > 1 ? 's' : ''} skipped: ${reasons}` : ''
  // How many more moves is not known without checking them with Proxmox: say more are needed.
  const cappedNote = capped ? `the cap of ${limit} action${limit > 1 ? 's' : ''} per conversation stops it there, more moves left for a later conversation` : ''

  if (steps.length === 0) {
    return {
      nothing: skipped.length
        ? `No guest of ${host.name} can move now (${skippedNote}).`
        : `No other host of ${host.cluster} has the RAM to take a guest of ${host.name}.`,
      notes,
    }
  }

  return {
    title: `Relieve the RAM of ${host.name}`,
    steps,
    summary: `${host.name} at ${host.memPct} % RAM, about ${r1((used / host.memTotalGb) * 100)} % once the ${steps.length} moves are done${[skippedNote, cappedNote].filter(Boolean).map(n => `; ${n}`).join('')}`,
    notes,
  }
}

async function pendingUpdates(args: Record<string, unknown>, ctx: ToolContext, actions: ActionsContext, planId: string): Promise<Built> {
  const host = groundedHost(args, ctx, actions, { userOnly: true })

  if (!(await hasNodePermission(PERMISSIONS.NODE_MANAGE, host.connId, host.name))) {
    throw new ToolScopeError(`You do not have the permission to put ${host.name} in or out of maintenance.`)
  }

  consumeProposal(ctx)

  const updates = await readPendingUpdates(ctx, host).catch(() => null)

  if (updates && updates.length === 0) return { nothing: `${host.name} has no pending update.` }

  const target = hostTarget(host)
  const steps: Step[] = []

  if (!host.maintenance) steps.push(await stepCard(actions, ctx, planId, steps, { kind: 'maintenance', target, params: { mode: 'enter' } }))

  steps.push({
    step: steps.length + 1,
    manual: {
      text: `Install the ${updates ? `${updates.length} ` : ''}pending updates of ${host.name} from the Rolling Update tab of ${host.cluster}, then come back for the next step.`,
      href: `/infrastructure/inventory?selectType=cluster&selectId=${encodeURIComponent(host.connId)}`,
    },
  })
  // A cap of one action per conversation leaves room for the enter step only:
  // the exit is then asked for in a new conversation (or done from the UI).
  if (cardCount(steps) < planCardLimit(actions)) {
    steps.push(await stepCard(actions, ctx, planId, steps, { kind: 'maintenance', target, params: { mode: 'exit' } }))

    return { title: `Install the pending updates of ${host.name}`, steps }
  }

  return { title: `Install the pending updates of ${host.name}`, steps, summary: `the exit from maintenance, ${laterNote(1)}` }
}

const BUILDERS: Record<PlanFinding, typeof unprotectedGuests> = {
  unprotected_guests: unprotectedGuests,
  host_memory: hostMemory,
  pending_updates: pendingUpdates,
}

const findingsFor = (kinds: readonly ActionKind[]) => PLAN_FINDINGS.filter(f => kinds.includes(FINDING_KIND[f]))

const FINDING_HINTS: Record<PlanFinding, string> = {
  unprotected_guests: 'unprotected_guests: add guests no backup job covers to an existing job (cluster optional).',
  host_memory: 'host_memory: move the biggest guests off a host short of RAM (host).',
  pending_updates: 'pending_updates: maintenance on, install the updates, maintenance off (host).',
}

const HOST_FINDINGS: readonly PlanFinding[] = ['host_memory', 'pending_updates']

/** Description and schema for these findings only, like propose_action for its kinds. */
function describePlanTool(findings: readonly PlanFinding[]): Pick<CatalogTool, 'description' | 'parameters'> {
  const hostFindings = HOST_FINDINGS.filter(f => findings.includes(f))
  const sample = findings.includes('pending_updates') ? 'pending_updates' : findings[0]
  const example = HOST_FINDINGS.includes(sample) ? `finding='${sample}', host='pve1'` : `finding='${sample}'`

  return {
    description:
      'Propose a step-by-step fix for a finding; nothing runs: the user approves each step on its card. ' +
      `${findings.map(f => FINDING_HINTS[f]).join(' ')} Example: ${example}`,
    parameters: {
      type: 'object',
      properties: {
        finding: { type: 'string', description: 'What to fix.', enum: [...findings] },
        ...(hostFindings.length ? { host: { type: 'string', description: `Host the finding is about (${hostFindings.join(', ')}).` } } : {}),
        cluster: { type: 'string', description: 'Cluster name, when the user names one.' },
      },
      required: ['finding'],
    },
  }
}

export const proposeRemediationPlanTool: CatalogTool = {
  name: 'propose_remediation_plan',
  readOnly: false,
  ...describePlanTool(PLAN_FINDINGS),
  async execute(args, ctx) {
    const actions = requireActions(ctx)
    const finding = argRequiredEnum(args, 'finding', findingsFor(enabledKinds(actions.settings)))

    assertProposalBudget(ctx)

    const release = reservePlan(ctx)
    const planId = randomUUID()
    let built: Built

    try {
      built = await BUILDERS[finding](args, ctx, actions, planId)
    } catch (e) {
      // A refused plan (argument, grounding, scope) frees its slot: the model may ask again, fixed.
      release()
      throw e
    }

    if ('nothing' in built) return proposalResult({ cards: [], plans: [] }, { status: 'nothing-to-do', proposed: built.nothing, checks: built.notes ?? [] })

    const plan: ActionPlan = { planId, finding, title: built.title, steps: built.steps }
    const checks = [
      ...built.steps.flatMap(s => (s.card?.preflight.checks ?? []).filter(c => c.level !== 'ok').map(c => ({ level: c.level, text: `Step ${s.step}: ${c.text}` }))),
      ...(built.notes ?? []),
    ].slice(0, MAX_PLAN_STEPS)

    return proposalResult(
      { cards: [], plans: [plan] },
      {
        status: 'awaiting-approval',
        proposed: `Proposed a ${built.steps.length}-step plan: ${built.title}${built.summary ? ` (${built.summary})` : ''}, waiting for the user's approval step by step`,
        checks,
      }
    )
  },
}

/** The plan tool cut to the findings the enabled kinds can serve (enum, description, arguments), or null when none. */
export function remediationToolFor(kinds: readonly ActionKind[]): CatalogTool | null {
  const findings = findingsFor(kinds)

  if (findings.length === 0) return null

  return { ...proposeRemediationPlanTool, ...describePlanTool(findings) }
}
