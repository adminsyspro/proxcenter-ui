/**
 * Remediation plans of the assistant (roadmap#188): a finding turned into at
 * most ten signed cards the user runs one step at a time.
 *
 * The steps come from the code, never from the model: the backup coverage
 * resolver picks the unprotected guests, the RAM arithmetic of
 * simulate_migration picks what moves where, the maintenance state decides
 * the update sequence. Only the host or cluster the finding is about must be
 * grounded in the conversation; the guests a plan names were chosen here.
 *
 * Proxmox load: no precondition read (each migration step is checked when it
 * runs); the backup jobs and the pending update list come from the caches the
 * read-only tools already fill.
 */

import { randomUUID } from 'node:crypto'

import { assertTargetGrounded, isGrounded, UNGROUNDED_TARGET_MESSAGE } from '@/lib/ai/actions/grounding'
import { preflightAction } from '@/lib/ai/actions/preflight'
import {
  argRequiredEnum,
  assertProposalBudget,
  consumeProposal,
  firstCompatibleJob,
  issueCard,
  proposalResult,
  requireActions,
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

type Step = ActionPlan['steps'][number]

type Built = { title: string; steps: Step[]; summary?: string } | { nothing: string }

const r1 = (v: number) => Math.round(v * 10) / 10

async function stepCard(
  actions: ActionsContext,
  ctx: ToolContext,
  planId: string,
  step: number,
  body: Pick<ActionCard, 'kind' | 'target' | 'params'>
): Promise<Step> {
  const preflight = await preflightAction(body, ctx, { inPlan: true })

  return { step, card: issueCard(actions, { ...body, preflight, planId, step }) }
}

function groundedHost(args: Record<string, unknown>, ctx: ToolContext, visibleText: string): SnapshotNode {
  const host = argString(args, 'host')

  if (!host) throw new ToolArgumentError('Pass host: the host the finding is about.')

  const { node } = resolveNode(ctx, host, argString(args, 'cluster'))

  assertTargetGrounded(visibleText, hostTarget(node))

  return node
}

async function unprotectedGuests(args: Record<string, unknown>, ctx: ToolContext, actions: ActionsContext, planId: string): Promise<Built> {
  const clusterRef = argString(args, 'cluster')
  const scope = clusterRef ? [resolveConnection(ctx, clusterRef)] : ctx.snapshot.clusters.map(c => ({ id: c.id, name: c.name }))

  if (clusterRef && !isGrounded(actions.visibleText, scope[0].name) && !isGrounded(actions.visibleText, scope[0].id)) {
    throw new ToolScopeError(UNGROUNDED_TARGET_MESSAGE)
  }

  // The add-to-job route refuses a vDC tenant: their jobs follow their pools.
  const allowed = []

  for (const c of scope) if ((await getAllowedJobPools(ctx.tenantId, c.id)) === null) allowed.push(c)

  if (allowed.length === 0) throw new ToolScopeError('Adding guests to backup jobs is not available to a vDC tenant: your backup jobs follow your pools.')

  consumeProposal(ctx)

  const { uncovered, jobsByConnection } = await computeBackupCoverage(ctx, allowed)
  const steps: Step[] = []
  let noJob = 0

  for (const u of uncovered) {
    if (steps.length >= MAX_PLAN_STEPS) break

    const guest = ctx.snapshot.guests.find(g => g.connId === u.connId && g.vmid === u.vmid)
    const job = firstCompatibleJob(jobsByConnection[u.connId] ?? [], { vmid: u.vmid, node: u.node })

    if (!guest || !job?.id) {
      noJob++
      continue
    }

    steps.push(await stepCard(actions, ctx, planId, steps.length + 1, { kind: 'backup_add', target: guestTarget(guest), params: { jobId: job.id } }))
  }

  if (steps.length === 0) {
    return { nothing: uncovered.length ? `None of the ${uncovered.length} unprotected guests fits an existing backup job: create a job from the Backups page.` : 'Every guest is protected by a backup job.' }
  }

  const left = uncovered.length - steps.length

  return {
    title: `Add ${steps.length} unprotected guests to existing backup jobs`,
    steps,
    summary: `${uncovered.length} unprotected, ${steps.length} in this plan${left > 0 ? `, ${left} left for a later plan` : ''}${noJob ? `, ${noJob} with no compatible job` : ''}`,
  }
}

async function hostMemory(args: Record<string, unknown>, ctx: ToolContext, actions: ActionsContext, planId: string): Promise<Built> {
  const host = groundedHost(args, ctx, actions.visibleText)

  consumeProposal(ctx)

  if (host.memPct <= HOST_MEMORY_TARGET_PCT) return { nothing: `${host.name} uses ${host.memPct} % of its RAM, under ${HOST_MEMORY_TARGET_PCT} %: nothing to relieve.` }

  // What the plan already sends to each host, so two steps never count the same free RAM.
  const planned = new Map<string, number>()
  const others = ctx.snapshot.nodes.filter(n => n.connId === host.connId && n.name !== host.name && n.status === 'online' && !n.maintenance)
  const movable = ctx.snapshot.guests
    .filter(g => g.connId === host.connId && g.node === host.name && g.status === 'running' && !g.template)
    .sort((a, b) => b.memUsedGb - a.memUsedGb)
  const steps: Step[] = []
  let used = host.memUsedGb

  for (const guest of movable) {
    if (steps.length >= MAX_PLAN_STEPS || (used / host.memTotalGb) * 100 <= HOST_MEMORY_TARGET_PCT) break

    const best = others
      .map(n => evaluateHostFit(ctx.snapshot, guest, { ...n, memUsedGb: n.memUsedGb + (planned.get(n.name) ?? 0) }))
      .filter(fit => fit.fits)
      .sort((a, b) => b.ramFreeAfterReserveGb - a.ramFreeAfterReserveGb)[0]

    if (!best) continue

    planned.set(best.host, (planned.get(best.host) ?? 0) + guest.memTotalGb)
    used -= guest.memUsedGb
    steps.push(await stepCard(actions, ctx, planId, steps.length + 1, { kind: 'migrate', target: guestTarget(guest), params: { target: best.host, online: true } }))
  }

  if (steps.length === 0) return { nothing: `No other host of ${host.cluster} has the RAM to take a guest of ${host.name}.` }

  return {
    title: `Relieve the RAM of ${host.name}`,
    steps,
    summary: `${host.name} at ${host.memPct} % RAM, about ${r1((used / host.memTotalGb) * 100)} % once the ${steps.length} moves are done`,
  }
}

async function pendingUpdates(args: Record<string, unknown>, ctx: ToolContext, actions: ActionsContext, planId: string): Promise<Built> {
  const host = groundedHost(args, ctx, actions.visibleText)

  if (!(await hasNodePermission(PERMISSIONS.NODE_MANAGE, host.connId, host.name))) {
    throw new ToolScopeError(`You do not have the permission to put ${host.name} in or out of maintenance.`)
  }

  consumeProposal(ctx)

  const updates = await readPendingUpdates(ctx, host).catch(() => null)

  if (updates && updates.length === 0) return { nothing: `${host.name} has no pending update.` }

  const target = hostTarget(host)
  const steps: Step[] = []

  if (!host.maintenance) steps.push(await stepCard(actions, ctx, planId, 1, { kind: 'maintenance', target, params: { mode: 'enter' } }))

  steps.push({
    step: steps.length + 1,
    manual: {
      text: `Install the ${updates ? `${updates.length} ` : ''}pending updates of ${host.name} from the Rolling Update tab of ${host.cluster}, then come back for the next step.`,
      href: `/infrastructure/inventory?selectType=cluster&selectId=${encodeURIComponent(host.connId)}`,
    },
  })
  steps.push(await stepCard(actions, ctx, planId, steps.length + 1, { kind: 'maintenance', target, params: { mode: 'exit' } }))

  return { title: `Install the pending updates of ${host.name}`, steps }
}

const BUILDERS: Record<PlanFinding, typeof unprotectedGuests> = {
  unprotected_guests: unprotectedGuests,
  host_memory: hostMemory,
  pending_updates: pendingUpdates,
}

const findingsFor = (kinds: readonly ActionKind[]) => PLAN_FINDINGS.filter(f => kinds.includes(FINDING_KIND[f]))

export const proposeRemediationPlanTool: CatalogTool = {
  name: 'propose_remediation_plan',
  readOnly: false,
  description:
    'Propose a step-by-step fix for a finding; nothing runs: the user approves each step on its card. unprotected_guests: add guests no backup job covers to an existing job (cluster optional). host_memory: move the biggest guests off a host short of RAM (host). pending_updates: maintenance on, install the updates, maintenance off (host). Example: finding=\'pending_updates\', host=\'pve1\'',
  parameters: {
    type: 'object',
    properties: {
      finding: { type: 'string', description: 'What to fix.', enum: [...PLAN_FINDINGS] },
      host: { type: 'string', description: 'Host the finding is about (host_memory, pending_updates).' },
      cluster: { type: 'string', description: 'Cluster name, when the user names one.' },
    },
    required: ['finding'],
  },
  async execute(args, ctx) {
    const actions = requireActions(ctx)
    const finding = argRequiredEnum(args, 'finding', findingsFor(enabledKinds(actions.settings)))

    assertProposalBudget(ctx)

    const planId = randomUUID()
    const built = await BUILDERS[finding](args, ctx, actions, planId)

    if ('nothing' in built) return proposalResult({ cards: [], plans: [] }, { status: 'nothing-to-do', proposed: built.nothing, checks: [] })

    const plan: ActionPlan = { planId, finding, title: built.title, steps: built.steps }
    const checks = built.steps
      .flatMap(s => (s.card?.preflight.checks ?? []).filter(c => c.level !== 'ok').map(c => ({ level: c.level, text: `Step ${s.step}: ${c.text}` })))
      .slice(0, MAX_PLAN_STEPS)

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

/** The plan tool cut to the findings the enabled kinds can serve, or null when none. */
export function remediationToolFor(kinds: readonly ActionKind[]): CatalogTool | null {
  const findings = findingsFor(kinds)

  if (findings.length === 0) return null

  const finding = proposeRemediationPlanTool.parameters.properties.finding

  return {
    ...proposeRemediationPlanTool,
    parameters: {
      ...proposeRemediationPlanTool.parameters,
      properties: { ...proposeRemediationPlanTool.parameters.properties, finding: { ...finding, enum: [...findings] } },
    },
  }
}
