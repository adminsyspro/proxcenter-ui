// /api/v1/compliance/hardening/[connectionId]/acceptances
// Risk acceptance of hardening checks on one connection: list, accept, revoke.
import { NextResponse } from 'next/server'

import { requireEnterprise } from '@/lib/auth/requireEnterprise'
import { checkPermission, getRBACContext, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId, verifyConnectionOwnership } from '@/lib/tenant'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'
import { demoResponse } from '@/lib/demo/demo-api'
import { withAudit } from '@/lib/audit/withAudit'
import { ALL_CHECK_IDS } from '@/lib/compliance/hardening'
import {
  acceptRisk, listRiskAcceptances, parseAcceptanceInput, revokeRiskAcceptance, serializeAcceptance,
} from '@/lib/compliance/riskAcceptance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ connectionId: string }> }

/**
 * Same guards as the hardening read, once the handler has turned an IaaS
 * tenant away (its vDC binding would otherwise hand it the provider's
 * connection); the connection id once they all pass.
 */
async function guard(ctx: Ctx): Promise<{ response: Response } | { connectionId: string; tenantId: string }> {
  const entGuard = await requireEnterprise()
  if (entGuard) return { response: entGuard }

  const { connectionId } = await ctx.params
  const ownershipError = await verifyConnectionOwnership(connectionId)
  if (ownershipError) return { response: ownershipError }

  const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE, 'connection', connectionId)
  if (denied) return { response: denied }

  return { connectionId, tenantId: await getCurrentTenantId() }
}

export async function GET(req: Request, ctx: Ctx) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const iaasDenied = await denyIaasTenant()
    if (iaasDenied) return iaasDenied

    const scope = await guard(ctx)
    if ('response' in scope) return scope.response

    const now = new Date()
    const rows = await listRiskAcceptances(scope.tenantId, scope.connectionId)
    return NextResponse.json({ data: rows.map(row => serializeAcceptance(row, now)) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

async function handlePost(req: Request, ctx: Ctx) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const iaasDenied = await denyIaasTenant()
    if (iaasDenied) return iaasDenied

    const scope = await guard(ctx)
    if ('response' in scope) return scope.response

    const input = parseAcceptanceInput(await req.json().catch(() => null))
    if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 400 })

    // The name kept with the acceptance: the signed-in user, or the API token.
    const principal = (await getRBACContext())?.principal
    const acceptedBy = principal?.userEmail || (principal?.tokenId ? `API token ${principal.tokenId}` : 'unknown')

    const saved = await acceptRisk(scope.tenantId, scope.connectionId, input, acceptedBy)
    return NextResponse.json({ data: serializeAcceptance(saved) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

async function handleDelete(req: Request, ctx: Ctx) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const iaasDenied = await denyIaasTenant()
    if (iaasDenied) return iaasDenied

    const scope = await guard(ctx)
    if ('response' in scope) return scope.response

    const checkId = new URL(req.url).searchParams.get('checkId') || ''
    if (!ALL_CHECK_IDS.includes(checkId)) return NextResponse.json({ error: 'Unknown check' }, { status: 400 })

    const removed = await revokeRiskAcceptance(scope.tenantId, scope.connectionId, checkId)
    if (!removed) return NextResponse.json({ error: 'No risk acceptance for this check' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

const AUDIT = { category: 'security', resourceType: 'compliance_risk_acceptance', resourceParam: 'connectionId' } as const

export const POST = withAudit({ ...AUDIT, action: 'create', resourceNameBodyField: 'check_id' }, handlePost)
export const DELETE = withAudit({ ...AUDIT, action: 'delete' }, handleDelete)
