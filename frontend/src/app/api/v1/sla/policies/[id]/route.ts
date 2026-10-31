// GET    /api/v1/sla/policies/{id}?period=30d   the policy, its summary and one result per guest, named, with its connection's name
// PUT    /api/v1/sla/policies/{id}              replace its name, target, selector and state
// DELETE /api/v1/sla/policies/{id}              remove it with its policy-scoped maintenance windows
//
// A policy of another tenant is a 404, like a missing one.

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { prisma } from '@/lib/db/prisma'
import { requireSlaManage, requireSlaRead } from '@/lib/availability/guard'
import { availabilityErrorResponse, codeResponse, notFound } from '@/lib/availability/orchestrator'
import { parsePeriod, periodBounds } from '@/lib/availability/period'
import {
  evaluatePolicy,
  guestsOnUnmeasured,
  isRowId,
  isUniqueViolation,
  policyData,
  policyInScope,
  policyView,
  rowGuests,
  withGuestNames,
} from '@/lib/availability/policies'
import { parsePolicyBody } from '@/lib/availability/validate'
import { getTenantPrisma } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, ctx: Ctx) {
  try {
    const access = await requireSlaRead()
    if (access.denied) return access.denied

    const { id } = await ctx.params
    if (!isRowId(id)) return notFound()
    const period = parsePeriod(new URL(request.url).searchParams.get('period'), '30d')
    if (period === null) return codeResponse('invalid_period', 400)

    const row = await getTenantPrisma(access.tenantId).slaPolicy.findFirst({ where: { id } })
    if (!row) return notFound()

    const now = new Date()
    const evaluation = await evaluatePolicy({ tenantId: access.tenantId, scope: access.scope }, id, period, now)
    const { from, to } = periodBounds(period, now)
    const connectionIds = [...new Set(evaluation.results.map(r => r.ref.connection_id))]
    const [results, connections] = await Promise.all([
      withGuestNames(access.scope, evaluation.results),
      prisma.connection.findMany({ where: { id: { in: connectionIds } }, select: { id: true, name: true } }),
    ])

    return NextResponse.json({
      policy: policyView(row),
      period,
      from,
      to,
      results,
      connectionNames: Object.fromEntries(connections.map(c => [c.id, c.name])),
      summary: evaluation.summary,
    })
  } catch (e) {
    return availabilityErrorResponse(e, 'get policy')
  }
}

async function handlePut(request: Request, ctx: Ctx) {
  try {
    const access = await requireSlaManage()
    if (access.denied) return access.denied

    const { id } = await ctx.params
    if (!isRowId(id)) return notFound()

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return codeResponse('invalid_body', 400)
    }
    const parsed = parsePolicyBody(body)
    if (parsed.ok === false) return codeResponse(parsed.error, 400)
    const input = parsed.value

    const db = getTenantPrisma(access.tenantId)
    const current = await db.slaPolicy.findFirst({ where: { id }, select: { guests: true } })
    if (!current) return notFound()

    if (!(await policyInScope(access.scope, access.connectionIds, input))) return codeResponse('guest_out_of_scope', 400)
    if (await guestsOnUnmeasured(input.guests, rowGuests(current))) return codeResponse('connection_not_measured', 400)

    if (await db.slaPolicy.findFirst({ where: { name: input.name, NOT: { id } }, select: { id: true } })) {
      return codeResponse('name_taken', 409)
    }

    try {
      const { count } = await db.slaPolicy.updateMany({ where: { id }, data: policyData(input) })
      if (count === 0) return notFound()
    } catch (e) {
      if (isUniqueViolation(e)) return codeResponse('name_taken', 409)
      throw e
    }

    const row = await db.slaPolicy.findFirst({ where: { id } })
    if (!row) return notFound()
    return NextResponse.json({ policy: policyView(row) })
  } catch (e) {
    return availabilityErrorResponse(e, 'update policy')
  }
}

async function handleDelete(_request: Request, ctx: Ctx) {
  try {
    const access = await requireSlaManage()
    if (access.denied) return access.denied

    const { id } = await ctx.params
    if (!isRowId(id)) return notFound()

    // No foreign key from the windows to the policy: both go in one
    // transaction, the windows first.
    const db = getTenantPrisma(access.tenantId)
    const [, deleted] = await db.$transaction([
      db.slaMaintenanceWindow.deleteMany({ where: { scope: 'policy', policyId: id } }),
      db.slaPolicy.deleteMany({ where: { id } }),
    ])
    if (deleted.count === 0) return notFound()

    return NextResponse.json({ deleted: true })
  } catch (e) {
    return availabilityErrorResponse(e, 'delete policy')
  }
}

export const PUT = withAudit(
  { category: 'alerts', resourceType: 'sla_policy', resourceParam: 'id', resourceNameBodyField: 'name' },
  handlePut,
)
export const DELETE = withAudit({ category: 'alerts', resourceType: 'sla_policy', resourceParam: 'id' }, handleDelete)
