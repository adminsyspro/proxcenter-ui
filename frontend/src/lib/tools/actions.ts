/**
 * Proposal tools of the assistant (roadmap#188).
 *
 * They never change anything. Each resolves its target on the caller's RBAC-
 * and vDC-filtered snapshot, refuses a target the conversation never showed
 * (Review Focus 1), runs the preflight and returns a signed card that only the
 * user's click can execute, with the user's own rights. They are not part of
 * TOOL_CATALOG nor READ_ONLY_TOOLS (MCP stays read-only): the chat routes add
 * them through `actionToolsFor`, after the licence check.
 */

import { assertClusterGrounded, assertTargetGrounded, isGrounded } from '@/lib/ai/actions/grounding'
import { DRS_AWAITING, preflightAction, SNAPSHOT_NAME_RE } from '@/lib/ai/actions/preflight'
import {
  argRequiredEnum,
  assertProposalBudget,
  cardResult,
  consumeProposal,
  defaultSnapshotName,
  firstCompatibleJob,
  issueCard,
  requireActions,
} from '@/lib/ai/actions/propose'
import { findTargetGuest, resolveActionTarget } from '@/lib/ai/actions/target'
import { ACTION_KINDS, enabledKinds, type ActionCard, type ActionKind, type AiActionsSettings } from '@/lib/ai/actions/types'
import { Features } from '@/lib/license/features'
import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS } from '@/lib/rbac'
import { getAllowedJobPools } from '@/lib/vdc/backupJobs'

import { proposeRemediationPlanTool, remediationToolFor } from './actionPlans'
import { drsMoveVisible, requireAutomationAccess } from './automation'
import { loadBackupJobs } from './backups'
import { evaluateHostFit } from './forecast'
import { hasNodePermission } from './guards'
import { argString, resolveGuest, ToolArgumentError, ToolScopeError, type CatalogTool, type ToolContext } from './types'

type Params = ActionCard['params']

/** The DRS recommendation a drs_apply proposal carries out, among those the caller may see. */
async function findRecommendation(args: Record<string, unknown>, ctx: ToolContext): Promise<any> {
  await requireAutomationAccess(Features.DRS, 'DRS')

  const res = await getOrchestratorClient().getRecommendations(false).catch(() => null)

  if (!res) throw new ToolScopeError('The DRS service is not reachable right now.')

  const recs = (Array.isArray(res.data) ? res.data : []).filter((r: any) => DRS_AWAITING.includes(r?.status))
  const id = argString(args, 'recommendation')

  if (id) {
    const rec = recs.find((r: any) => String(r.id) === id)

    if (!rec || !drsMoveVisible(ctx.snapshot, rec)) throw new ToolScopeError(`No pending DRS recommendation "${id}" is visible to you.`)

    return rec
  }

  const guest = resolveGuest(ctx, argString(args, 'guest'))
  const rec = recs.find((r: any) => r.connection_id === guest.connId && String(r.vmid) === guest.vmid && drsMoveVisible(ctx.snapshot, r))

  if (!rec) throw new ToolScopeError(`DRS has no pending recommendation for ${guest.name}.`)

  return rec
}

/**
 * The destination of a migration: the host the user named, or the one with
 * the most free RAM. A host only the model named is ignored, like a cluster
 * the user never named (`groundClusterArgument`): it may come from a tool
 * result. A host of another cluster is refused outright.
 */
function migrationTarget(args: Record<string, unknown>, target: ActionCard['target'], ctx: ToolContext, visibleText: string): string {
  const guest = findTargetGuest(ctx, target)

  if (!guest) throw new ToolScopeError(`No VM or container ${target.name} is visible to you.`)

  const ref = argString(args, 'target_host')?.toLowerCase()

  if (ref) {
    const named = ctx.snapshot.nodes.filter(n => n.name.toLowerCase() === ref)
    const inCluster = named.find(n => n.connId === guest.connId)

    if (!inCluster) {
      throw new ToolScopeError(
        named.length
          ? `${named[0].name} is in cluster ${named[0].cluster}: the assistant only proposes a move within ${guest.cluster}, the cluster of ${guest.name}.`
          : `Unknown host "${ref}" in cluster ${guest.cluster}.`
      )
    }

    if (isGrounded(visibleText, inCluster.name)) return inCluster.name
  }

  const best = ctx.snapshot.nodes
    .filter(n => n.connId === guest.connId && n.name !== guest.node && n.status === 'online' && !n.maintenance)
    .map(n => evaluateHostFit(ctx.snapshot, guest, n))
    .filter(fit => fit.fits)
    .sort((a, b) => b.ramFreeAfterReserveGb - a.ramFreeAfterReserveGb)[0]

  if (!best) throw new ToolScopeError(`No other host of ${guest.cluster} can take ${guest.name} right now (RAM, maintenance or offline).`)

  return best.host
}

async function backupParams(args: Record<string, unknown>, target: ActionCard['target'], ctx: ToolContext): Promise<Params> {
  if ((await getAllowedJobPools(ctx.tenantId, target.connId)) !== null) {
    throw new ToolScopeError('Adding a guest to a backup job is not available to a vDC tenant: your backup jobs follow your pools.')
  }

  const jobs = await loadBackupJobs(ctx, target.connId)
  const ref = argString(args, 'job')

  if (ref) {
    const job = jobs.find(j => j.id === ref)

    if (!job) throw new ToolScopeError(`No backup job "${ref}" on ${target.cluster}. Jobs: ${jobs.map(j => j.id).join(', ') || 'none'}.`)

    return { jobId: ref }
  }

  const job = firstCompatibleJob(jobs, { vmid: String(target.vmid), node: target.node })

  if (!job?.id) throw new ToolScopeError(`No backup job of ${target.cluster} can take ${target.name}: create one from the Backups page.`)

  return { jobId: job.id }
}

async function maintenanceParams(args: Record<string, unknown>, target: ActionCard['target'], ctx: ToolContext): Promise<Params> {
  if (!(await hasNodePermission(PERMISSIONS.NODE_MANAGE, target.connId, target.node))) {
    throw new ToolScopeError(`You do not have the permission to put ${target.name} in or out of maintenance.`)
  }

  const host = ctx.snapshot.nodes.find(n => n.connId === target.connId && n.name === target.node)
  const mode = argString(args, 'mode') ? argRequiredEnum(args, 'mode', ['enter', 'exit']) : host?.maintenance ? 'exit' : 'enter'

  return { mode }
}

function snapshotParams(args: Record<string, unknown>, ctx: ToolContext): Params {
  const name = argString(args, 'snapshot_name') ?? defaultSnapshotName(ctx.timeZone)

  if (!SNAPSHOT_NAME_RE.test(name)) {
    throw new ToolArgumentError(`Invalid snapshot_name "${name}": a letter, then 1 to 39 letters, digits, - or _. Omit it for a dated name.`)
  }

  return { name }
}

export const proposeActionTool: CatalogTool = {
  name: 'propose_action',
  readOnly: false,
  description:
    'Propose ONE action on a guest or host the user named; nothing runs: the user gets a card and approves it with their own rights. Use only when the user asks for the action. Kinds: start, shutdown, reboot, snapshot (snapshot_name optional), migrate (target_host optional), drs_apply (guest or recommendation id), backup_add (job optional), maintenance (host, mode enter|exit). Example: action=\'reboot\', guest=\'web-01\'',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'What to do.', enum: [...ACTION_KINDS] },
      guest: { type: 'string', description: 'VM or container name or vmid, as the user wrote it.' },
      host: { type: 'string', description: 'Host name, for maintenance.' },
      cluster: { type: 'string', description: 'Cluster name, only when two clusters share the name.' },
      target_host: { type: 'string', description: 'migrate: destination host the user named. Omit to let ProxCenter pick.' },
      snapshot_name: { type: 'string', description: 'snapshot: name, a letter then letters, digits, - or _.' },
      recommendation: { type: 'string', description: 'drs_apply: recommendation id, else pass guest.' },
      job: { type: 'string', description: 'backup_add: backup job id. Omit for the first compatible job.' },
      mode: { type: 'string', description: 'maintenance: enter or exit.', enum: ['enter', 'exit'] },
    },
    required: ['action'],
  },
  async execute(args, ctx) {
    const actions = requireActions(ctx)
    const kind = argRequiredEnum(args, 'action', enabledKinds(actions.settings))

    assertProposalBudget(ctx)
    assertClusterGrounded(actions, ctx, argString(args, 'cluster'))

    const rec = kind === 'drs_apply' ? await findRecommendation(args, ctx) : null
    const target = rec
      ? resolveActionTarget({ kind, guest: String(rec.vmid), connId: rec.connection_id }, ctx)
      : resolveActionTarget({ kind, guest: argString(args, 'guest'), host: argString(args, 'host'), cluster: argString(args, 'cluster') }, ctx)

    assertTargetGrounded(actions, target)
    consumeProposal(ctx)

    let params: Params = {}

    if (kind === 'snapshot') params = snapshotParams(args, ctx)
    else if (kind === 'migrate') params = { target: migrationTarget(args, target, ctx, actions.visibleText), online: true }
    else if (kind === 'drs_apply') params = { recommendationId: String(rec.id) }
    else if (kind === 'backup_add') params = await backupParams(args, target, ctx)
    else if (kind === 'maintenance') params = await maintenanceParams(args, target, ctx)

    const preflight = await preflightAction({ kind, target, params }, ctx)

    return cardResult(issueCard(actions, { kind, target, params, preflight }))
  },
}

export { proposeRemediationPlanTool }

/** Both tools in full, every kind and finding: what the chat routes narrow per tenant. */
export const ACTION_TOOLS: CatalogTool[] = [proposeActionTool, proposeRemediationPlanTool]

/**
 * The proposal tools a tenant's settings allow: none when actions are off or
 * no kind is enabled, the `action` enum cut to the enabled kinds, and the plan
 * tool only for a finding whose action kind is enabled. The licence is checked
 * by the caller; `execute` re-checks the settings in `ctx.actions` anyway.
 */
export function actionToolsFor(settings: AiActionsSettings): CatalogTool[] {
  const kinds: ActionKind[] = enabledKinds(settings)

  if (kinds.length === 0) return []

  const action = proposeActionTool.parameters.properties.action
  const tools: CatalogTool[] = [
    {
      ...proposeActionTool,
      parameters: { ...proposeActionTool.parameters, properties: { ...proposeActionTool.parameters.properties, action: { ...action, enum: kinds } } },
    },
  ]
  const plan = remediationToolFor(kinds)

  if (plan) tools.push(plan)

  return tools
}
