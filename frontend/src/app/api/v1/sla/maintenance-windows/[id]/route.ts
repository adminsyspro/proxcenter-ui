// PUT    /api/v1/sla/maintenance-windows/{id}   replace a window
// DELETE /api/v1/sla/maintenance-windows/{id}   remove it
//
// A window of another tenant, or outside the caller's perimeter, is a 404
// like a missing one.

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { requireSlaManage } from '@/lib/availability/guard'
import { availabilityErrorResponse, codeResponse, notFound } from '@/lib/availability/orchestrator'
import { isRowId } from '@/lib/availability/policies'
import { parseWindowBody, windowVisible } from '@/lib/availability/validate'
import { windowData, windowTargetError, windowView } from '@/lib/availability/windows'
import { getTenantPrisma } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

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
    const parsed = parseWindowBody(body)
    if (parsed.ok === false) return codeResponse(parsed.error, 400)
    const input = parsed.value

    const db = getTenantPrisma(access.tenantId)
    const existing = await db.slaMaintenanceWindow.findFirst({ where: { id } })
    if (!existing || !windowVisible(access.scope, access.connectionIds, existing)) return notFound()

    const targetError = await windowTargetError(access.scope, access.connectionIds, input,
      async policyId => !!(await db.slaPolicy.findFirst({ where: { id: policyId }, select: { id: true } })))
    if (targetError) return codeResponse(targetError, 400)

    const { count } = await db.slaMaintenanceWindow.updateMany({ where: { id }, data: windowData(input) })
    if (count === 0) return notFound()
    const row = await db.slaMaintenanceWindow.findFirst({ where: { id } })
    if (!row) return notFound()

    return NextResponse.json({ window: windowView(row) })
  } catch (e) {
    return availabilityErrorResponse(e, 'update maintenance window')
  }
}

async function handleDelete(_request: Request, ctx: Ctx) {
  try {
    const access = await requireSlaManage()
    if (access.denied) return access.denied

    const { id } = await ctx.params
    if (!isRowId(id)) return notFound()

    const db = getTenantPrisma(access.tenantId)
    const existing = await db.slaMaintenanceWindow.findFirst({ where: { id } })
    if (!existing || !windowVisible(access.scope, access.connectionIds, existing)) return notFound()

    const { count } = await db.slaMaintenanceWindow.deleteMany({ where: { id } })
    if (count === 0) return notFound()

    return NextResponse.json({ deleted: true })
  } catch (e) {
    return availabilityErrorResponse(e, 'delete maintenance window')
  }
}

export const PUT = withAudit({ category: 'alerts', resourceType: 'sla_maintenance_window', resourceParam: 'id' }, handlePut)
export const DELETE = withAudit({ category: 'alerts', resourceType: 'sla_maintenance_window', resourceParam: 'id' }, handleDelete)
