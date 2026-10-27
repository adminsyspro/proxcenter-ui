// GET  /api/v1/sla/maintenance-windows?page=1   one page of the windows the caller may see, latest first
// POST /api/v1/sla/maintenance-windows          declare a window
//
// sla_monitoring on both; the write also needs alerts.manage. A window ends
// after it starts, lasts 31 days at most, and targets something inside the
// caller's perimeter.

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { requireSlaManage, requireSlaRead } from '@/lib/availability/guard'
import { availabilityErrorResponse, codeResponse } from '@/lib/availability/orchestrator'
import { PAGE_SIZE } from '@/lib/availability/policies'
import { parsePage, parseWindowBody, windowVisible } from '@/lib/availability/validate'
import { windowData, windowTargetError, windowView } from '@/lib/availability/windows'
import { getTenantPrisma } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const access = await requireSlaRead()
    if (access.denied) return access.denied

    const page = parsePage(new URL(request.url).searchParams.get('page'))
    if (page === null) return codeResponse('invalid_page', 400)

    // Filtered in memory: whether a window is visible depends on the
    // perimeter, which the table does not hold. Windows are few.
    const rows = await getTenantPrisma(access.tenantId).slaMaintenanceWindow.findMany({
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    })
    const visible = rows.filter(w => windowVisible(access.scope, access.connectionIds, w))
    const start = (page - 1) * PAGE_SIZE

    return NextResponse.json({
      data: visible.slice(start, start + PAGE_SIZE).map(windowView),
      total: visible.length,
      page,
      pageSize: PAGE_SIZE,
    })
  } catch (e) {
    return availabilityErrorResponse(e, 'list maintenance windows')
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
    const parsed = parseWindowBody(body)
    if (parsed.ok === false) return codeResponse(parsed.error, 400)
    const input = parsed.value

    const db = getTenantPrisma(access.tenantId)
    const targetError = await windowTargetError(access.scope, access.connectionIds, input,
      async id => !!(await db.slaPolicy.findFirst({ where: { id }, select: { id: true } })))
    if (targetError) return codeResponse(targetError, 400)

    const row = await db.slaMaintenanceWindow.create({ data: { ...windowData(input), createdBy: access.userEmail } })
    return NextResponse.json({ window: windowView(row) }, { status: 201 })
  } catch (e) {
    return availabilityErrorResponse(e, 'create maintenance window')
  }
}

export const POST = withAudit({ category: 'alerts', resourceType: 'sla_maintenance_window' }, handlePost)
