// GET  /api/v1/sla/policies?period=30d&page=1   one page of the tenant's policies, each with its summary
// GET  /api/v1/sla/policies?fields=names        every policy as { id, name, enabled }, no summary, no orchestrator call
// POST /api/v1/sla/policies                     create a policy
//
// sla_monitoring on both; the write also needs alerts.manage. A ticked guest
// or a pool outside the caller's perimeter is refused with a code, never a
// name.

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { requireSlaManage, requireSlaRead } from '@/lib/availability/guard'
import { availabilityErrorResponse, codeResponse, upstreamStatus } from '@/lib/availability/orchestrator'
import { parsePeriod, periodBounds } from '@/lib/availability/period'
import {
  PAGE_SIZE,
  evaluatePolicy,
  isUniqueViolation,
  policyData,
  policyInScope,
  policyView,
} from '@/lib/availability/policies'
import { getDefaultTarget } from '@/lib/availability/settings'
import type { QueryResponse } from '@/lib/availability/types'
import { parsePage, parsePolicyBody } from '@/lib/availability/validate'
import { getTenantPrisma } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Most policies the names mode returns. */
const NAMES_MAX = 1000

export async function GET(request: Request) {
  try {
    const access = await requireSlaRead()
    if (access.denied) return access.denied

    const params = new URL(request.url).searchParams

    // The light mode of the pickers: names only, so no evaluation is asked of
    // the orchestrator. Bounded, not paged.
    const fields = params.get('fields')
    if (fields !== null) {
      if (fields !== 'names') return codeResponse('invalid_fields', 400)
      const named = await getTenantPrisma(access.tenantId).slaPolicy.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: NAMES_MAX,
        select: { id: true, name: true, enabled: true },
      })
      return NextResponse.json({ items: named.map(p => ({ id: p.id, name: p.name, enabled: p.enabled })) })
    }

    const period = parsePeriod(params.get('period'), '30d')
    if (period === null) return codeResponse('invalid_period', 400)
    const page = parsePage(params.get('page'))
    if (page === null) return codeResponse('invalid_page', 400)

    const db = getTenantPrisma(access.tenantId)
    const [total, rows, defaultTarget] = await Promise.all([
      db.slaPolicy.count(),
      db.slaPolicy.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      getDefaultTarget(),
    ])

    const now = new Date()
    // One query per policy of the page (20 at most), in parallel. A policy
    // deleted meanwhile answers 404: its row keeps no summary.
    const evaluations = await Promise.all(rows.map(row =>
      evaluatePolicy({ tenantId: access.tenantId, scope: access.scope }, row.id, period, now).catch((e: unknown): QueryResponse | null => {
        if (upstreamStatus(e) === 404) return null
        throw e
      })))

    const { from, to } = periodBounds(period, now)
    return NextResponse.json({
      data: rows.map((row, i) => ({
        ...policyView(row),
        summary: evaluations[i]?.summary ?? null,
        guestCount: evaluations[i]?.results.length ?? 0,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      period,
      from,
      to,
      defaultTarget,
    })
  } catch (e) {
    return availabilityErrorResponse(e, 'list policies')
  }
}

async function handlePost(request: Request) {
  try {
    const access = await requireSlaManage()
    if (access.denied) return access.denied

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return codeResponse('invalid_body', 400)
    }
    const parsed = parsePolicyBody(body)
    if (parsed.ok === false) return codeResponse(parsed.error, 400)
    const input = parsed.value

    if (!(await policyInScope(access.scope, access.connectionIds, input))) return codeResponse('guest_out_of_scope', 400)

    const db = getTenantPrisma(access.tenantId)
    if (await db.slaPolicy.findFirst({ where: { name: input.name }, select: { id: true } })) {
      return codeResponse('name_taken', 409)
    }

    try {
      const row = await db.slaPolicy.create({ data: { ...policyData(input), createdBy: access.userEmail } })
      return NextResponse.json({ policy: policyView(row) }, { status: 201 })
    } catch (e) {
      if (isUniqueViolation(e)) return codeResponse('name_taken', 409)
      throw e
    }
  } catch (e) {
    return availabilityErrorResponse(e, 'create policy')
  }
}

export const POST = withAudit({ category: 'alerts', resourceType: 'sla_policy', resourceNameBodyField: 'name' }, handlePost)
