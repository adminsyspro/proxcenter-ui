export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { dispatchAction, type DispatchResult } from '@/lib/ai/actions/dispatch'
import { preflightAction } from '@/lib/ai/actions/preflight'
import { describeCard } from '@/lib/ai/actions/propose'
import { getAiActionsSettings } from '@/lib/ai/actions/settings'
import { actionTier, isHostKind, resolveActionTarget } from '@/lib/ai/actions/target'
import { verifyCard } from '@/lib/ai/actions/token'
import { enabledKinds, type ActionBinding, type ActionCard } from '@/lib/ai/actions/types'
import { audit, type AuditCategory } from '@/lib/audit'
import { auditOrigin } from '@/lib/audit/origin'
import { withAudit } from '@/lib/audit/withAudit'
import { getPrincipal } from '@/lib/auth/principal'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { prisma } from '@/lib/db/prisma'
import { Features } from '@/lib/license/features'
import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { buildToolContext } from '@/lib/tools/catalog'
import { collectInventorySnapshot } from '@/lib/tools/snapshot'
import { ToolScopeError, type ToolContext } from '@/lib/tools/types'

export const runtime = "nodejs"

/**
 * POST /api/v1/ai/actions/execute  { card, conversationId, confirmed? }
 *
 * The only way an action the assistant proposed ever runs (roadmap#188): the
 * user's click on its signed card. Every check is replayed here, in a fixed
 * order, each refusal with its own code; then the card goes through the route
 * the UI button calls (lib/ai/actions/dispatch), inside this request, so the
 * user's RBAC, vDC guard and audit apply unchanged. Every outcome leaves an
 * `ai.action` row; the rows the existing route writes carry the origin.
 */

const MAX_CONVERSATION_ID = 200

type Refusal = { status: number; code: string; message: string; checks?: ActionCard['preflight']['checks'] }

type Verified = { card: ActionCard; conversationId: string; confirmed: boolean; tenantId: string; userId: string; baseUrl: string }

/** Answered for any unexpected failure: the real error, which can name the database or a secret, stays in the server log. */
const INTERNAL_MESSAGE = 'The action could not be run. Try again.'

const refusal = (status: number, code: string, message: string, extra: Partial<Refusal> = {}): Refusal => ({ status, code, message, ...extra })

function categoryOf(card: ActionCard): AuditCategory {
  switch (card.kind) {
    case 'maintenance':
      return 'nodes'
    case 'backup_add':
      return 'backups'
    case 'drs_apply':
      return 'automation'
    default:
      return card.target.guestKind === 'lxc' ? 'containers' : 'vms'
  }
}

/** The `ai.action` row of a verified card: the target and the trail (conversation, action, plan step). */
async function auditCard(card: ActionCard, conversationId: string, outcome: 'dispatched' | 'refused', status: number, extra: { code?: string; error?: string; userId: string }) {
  const host = isHostKind(card.kind)
  const ok = outcome === 'dispatched' && status >= 200 && status < 300

  await audit({
    action: 'ai.action',
    // Stated, not left to the session lookup: replay, cap and plan order filter on it.
    userId: extra.userId,
    category: categoryOf(card),
    resourceType: host ? 'node' : card.target.guestKind,
    resourceId: host ? card.target.node : String(card.target.vmid),
    resourceName: card.target.name,
    status: ok ? 'success' : 'failure',
    ...(ok || !extra.error ? {} : { errorMessage: extra.error.slice(0, 500) }),
    details: {
      via: 'assistant',
      conversationId,
      actionId: card.actionId,
      kind: card.kind,
      ...(card.planId ? { planId: card.planId, step: card.step } : {}),
      outcome,
      ...(extra.code ? { code: extra.code } : {}),
      httpStatus: status,
      target: describeCard(card),
    },
  })
}

/**
 * The `ai.action` row of a refusal before the card is known to be ours: no
 * claim of the card (ids, target) is recorded, they could be forged.
 */
async function auditUnverified(r: Refusal) {
  await audit({
    action: 'ai.action',
    category: 'automation',
    resourceType: 'ai_action',
    status: 'failure',
    errorMessage: r.message,
    details: { via: 'assistant', outcome: 'refused', code: r.code, httpStatus: r.status },
  })
}

function respond(r: Refusal) {
  return NextResponse.json(
    { ok: false, code: r.code, message: r.message, ...(r.checks ? { checks: r.checks } : {}) },
    { status: r.status }
  )
}

async function refuseUnverified(r: Refusal) {
  await auditUnverified(r).catch(e => console.error('[ai/actions/execute] audit failed:', e?.message || e))

  return respond(r)
}

/** A guard helper's own refusal (RBAC, licence), in this route's shape with its status kept. */
async function fromGuard(res: Response, code: string): Promise<Refusal> {
  const payload = await res.clone().json().catch(() => null)
  const message = typeof payload?.error === 'string' ? payload.error : typeof payload?.message === 'string' ? payload.message : 'Forbidden'

  return refusal(res.status, code, message)
}

// ---------------------------------------------------------------------------
// One execution at a time per conversation, in this process: a double click
// waits for the first run to finish, then finds its audit row and is refused
// as already executed, and two cards cannot both slip under the cap.
// ---------------------------------------------------------------------------

const LOCKS_KEY = Symbol.for('proxcenter.aiActionLocks')
const g = globalThis as unknown as Record<symbol, Map<string, Promise<unknown>> | undefined>
const locks: Map<string, Promise<unknown>> = g[LOCKS_KEY] ?? (g[LOCKS_KEY] = new Map())

async function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  const tail = run.catch(() => undefined)

  locks.set(key, tail)

  try {
    return await run
  } finally {
    if (locks.get(key) === tail) locks.delete(key)
  }
}

// ---------------------------------------------------------------------------
// The audit trail as the source of replay, cap and plan order: one durable
// store, shared by every instance. Always per user too: the conversation id
// is chosen by the browser, so two users of a tenant could share one, and
// neither may spend or unlock the other's actions.
// ---------------------------------------------------------------------------

type Owner = { tenantId: string; userId: string }

const detail = (key: string, value: string | number) => ({ details: { path: [key], equals: value } })

async function alreadyExecuted({ tenantId, userId }: Owner, actionId: string): Promise<boolean> {
  const row = await prisma.auditLog.findFirst({
    where: { tenantId, userId, action: 'ai.action', status: 'success', AND: [detail('actionId', actionId), detail('outcome', 'dispatched')] },
    select: { id: true },
  })

  return row !== null
}

async function dispatchedInConversation({ tenantId, userId }: Owner, conversationId: string): Promise<number> {
  return prisma.auditLog.count({
    where: { tenantId, userId, action: 'ai.action', AND: [detail('conversationId', conversationId), detail('outcome', 'dispatched')] },
  })
}

async function stepSucceeded({ tenantId, userId }: Owner, planId: string, step: number): Promise<boolean> {
  const row = await prisma.auditLog.findFirst({
    where: { tenantId, userId, action: 'ai.action', status: 'success', AND: [detail('planId', planId), detail('step', step), detail('outcome', 'dispatched')] },
    select: { id: true },
  })

  return row !== null
}

// ---------------------------------------------------------------------------

/** The card's target re-resolved on the caller's current snapshot, or why not. */
function retarget(card: ActionCard, ctx: ToolContext): { target: ActionCard['target'] } | Refusal {
  let target: ActionCard['target']

  try {
    target = isHostKind(card.kind)
      ? resolveActionTarget({ kind: card.kind, host: card.target.node, connId: card.target.connId }, ctx)
      : resolveActionTarget({ kind: card.kind, guest: String(card.target.vmid), connId: card.target.connId }, ctx)
  } catch (e) {
    if (e instanceof ToolScopeError) return refusal(404, 'out-of-scope', e.message)
    throw e
  }

  const was = card.target

  if (target.node !== was.node) {
    return refusal(409, 'target-changed', `${was.name} is now on ${target.node}, not ${was.node}: ask the assistant again.`)
  }

  if (!isHostKind(card.kind) && (target.guestKind !== was.guestKind || target.name !== was.name)) {
    return refusal(409, 'target-changed', `VM or container ${was.vmid} is now ${target.name}, not ${was.name}: ask the assistant again.`)
  }

  return { target }
}

/** R14: the DRS recommendation must still be about the card's guest. */
async function drsRetarget(card: ActionCard): Promise<Refusal | null> {
  const res = await getOrchestratorClient().getRecommendations(false).catch(() => null)
  const rec: any = (Array.isArray(res?.data) ? res.data : []).find((r: any) => String(r?.id) === String(card.params.recommendationId))

  // Missing or unreachable: the preflight says so with its own words.
  if (!rec) return null

  if (rec.connection_id !== card.target.connId || String(rec.vmid) !== String(card.target.vmid)) {
    return refusal(409, 'target-changed', `This DRS recommendation is no longer about ${card.target.name}: ask the assistant again.`)
  }

  return null
}

function successMessage(card: ActionCard, d: DispatchResult): string {
  const m = [d.body?.message, d.body?.data?.message].find((v): v is string => typeof v === 'string' && v.length > 0)

  return m ?? `${d.upid ? 'Started' : 'Done'}: ${describeCard(card)}`
}

function routeError(d: DispatchResult): string {
  const m = [d.body?.error, d.body?.message].find((v): v is string => typeof v === 'string' && v.length > 0)

  return m ?? `The route answered HTTP ${d.httpStatus}`
}

/** Every check after the signature, in the plan's order, then the dispatch. */
async function executeVerified(v: Verified): Promise<Response> {
  const { card, conversationId, tenantId } = v
  const owner: Owner = { tenantId, userId: v.userId }

  const refuse = async (r: Refusal) => {
    await auditCard(card, conversationId, 'refused', r.status, { code: r.code, error: r.message, userId: v.userId })
      .catch(e => console.error('[ai/actions/execute] audit failed:', e?.message || e))

    return respond(r)
  }

  const settings = await getAiActionsSettings(tenantId)

  if (!enabledKinds(settings).includes(card.kind)) {
    return refuse(refusal(403, 'action-disabled', `The "${card.kind}" action is not enabled in the assistant settings.`))
  }

  if ((card.tier === 'disruptive' || actionTier(card.kind, card.target) === 'disruptive') && !v.confirmed) {
    return refuse(refusal(400, 'confirmation-required', `Confirm first: ${describeCard(card)}.`))
  }

  if (await alreadyExecuted(owner, card.actionId)) {
    return refuse(refusal(409, 'already-executed', 'This action was already executed.'))
  }

  if ((await dispatchedInConversation(owner, conversationId)) >= settings.maxPerConversation) {
    return refuse(refusal(429, 'cap-reached', `At most ${settings.maxPerConversation} actions can be executed per conversation: start a new conversation.`))
  }

  if (card.after !== undefined && !(card.planId && (await stepSucceeded(owner, card.planId, card.after)))) {
    return refuse(refusal(409, 'previous-step-pending', `Step ${card.after} of this plan has not succeeded yet.`))
  }

  const ctx = buildToolContext(await collectInventorySnapshot(), tenantId, 'en')
  const resolved = retarget(card, ctx)

  if (!('target' in resolved)) return refuse(resolved)

  if (card.kind === 'drs_apply') {
    const changed = await drsRetarget(card)

    if (changed) return refuse(changed)
  }

  // Without `inPlan`: a migration reads the Proxmox precondition here.
  const preflight = await preflightAction({ kind: card.kind, target: resolved.target, params: card.params }, ctx)

  if (!preflight.ok) {
    const block = preflight.checks.find(c => c.level === 'block')

    return refuse(refusal(409, 'preflight-failed', block?.text ?? 'The action is blocked.', { checks: preflight.checks }))
  }

  const dispatched = await auditOrigin.run({ via: 'assistant', conversationId, actionId: card.actionId }, () => dispatchAction(card, v.baseUrl))
  const ok = dispatched.httpStatus >= 200 && dispatched.httpStatus < 300
  const message = ok ? successMessage(card, dispatched) : routeError(dispatched)

  // The action ran: a lost row must not turn its answer into an error.
  await auditCard(card, conversationId, 'dispatched', dispatched.httpStatus, ok ? { userId: v.userId } : { error: message, userId: v.userId })
    .catch(e => console.error('[ai/actions/execute] audit of a dispatched action failed:', e?.message || e))

  if (!ok) {
    return NextResponse.json({ ok: false, code: 'route-refused', message, httpStatus: dispatched.httpStatus }, { status: dispatched.httpStatus })
  }

  return NextResponse.json({
    ok: true,
    result: {
      ...(dispatched.upid ? { upid: dispatched.upid } : {}),
      node: card.target.node,
      connId: card.target.connId,
      message,
    },
  })
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function handler(req: Request) {
  // Hoisted so an unexpected failure after the signature still leaves the card's row (R4).
  let verified: Verified | undefined

  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return refuseUnverified(await fromGuard(denied, 'forbidden'))

    // Approved actions are an add-on of the assistant: both features, here too.
    for (const feature of [Features.AI_INSIGHTS, Features.AI_ACTIONS]) {
      const unlicensed = await requireFeature(feature)
      if (unlicensed) return refuseUnverified(await fromGuard(unlicensed, 'not-licensed'))
    }

    // R13: an interactive session only; an API token has no conversation.
    const { principal } = await getPrincipal()

    if (principal?.kind !== 'session' || !principal.userId) {
      return refuseUnverified(refusal(403, 'session-required', 'Approved actions can only be executed from a signed-in session.'))
    }

    const body = await req.json().catch(() => null)
    const card = isRecord(body) ? body.card : undefined
    const conversationId = isRecord(body) ? body.conversationId : undefined

    if (!isRecord(card) || typeof conversationId !== 'string' || !conversationId || conversationId.length > MAX_CONVERSATION_ID) {
      return refuseUnverified(refusal(400, 'bad-request', 'Send { card, conversationId, confirmed? }.'))
    }

    const tenantId = await getCurrentTenantId()
    const bind: ActionBinding = { userId: principal.userId, tenantId, conversationId }
    const verdict = verifyCard(card as ActionCard, bind)

    if (!verdict.ok) {
      if (verdict.reason === 'bad-signature') {
        return refuseUnverified(refusal(400, 'bad-signature', 'This card was not issued to you in this conversation, or it was altered.'))
      }

      // Expired but authentic: its claims are ours, audit them.
      await auditCard(card as ActionCard, conversationId, 'refused', 400, { code: 'expired', error: 'This card expired.', userId: principal.userId })
        .catch(e => console.error('[ai/actions/execute] audit failed:', e?.message || e))

      return respond(refusal(400, 'expired', 'This card expired: ask the assistant again.'))
    }

    // From here the card is one this server issued, unaltered.
    const v: Verified = {
      card: card as ActionCard,
      conversationId,
      confirmed: isRecord(body) && body.confirmed === true,
      tenantId,
      userId: principal.userId,
      baseUrl: req.url,
    }

    verified = v

    return await serialized(`${tenantId}|${principal.userId}|${conversationId}`, () => executeVerified(v))
  } catch (e: unknown) {
    console.error('[ai/actions/execute] Error:', e)

    if (verified) {
      await auditCard(verified.card, verified.conversationId, 'refused', 500, { code: 'internal-error', error: INTERNAL_MESSAGE, userId: verified.userId })
        .catch(err => console.error('[ai/actions/execute] audit failed:', err?.message || err))
    }

    return NextResponse.json({ ok: false, code: 'internal-error', message: INTERNAL_MESSAGE }, { status: 500 })
  }
}

export const POST = withAudit({ category: "automation", resourceType: "ai_action", action: "execute" }, handler)
