// GET    /api/v1/backups/restore-drills/schedules/{id}    one schedule, its last runs and events
// PUT    /api/v1/backups/restore-drills/schedules/{id}    replace its settings (rotation state kept)
// DELETE /api/v1/backups/restore-drills/schedules/{id}    remove it; its drills stay in the history

import { NextResponse } from 'next/server'

import { drillErrorResponse } from '@/lib/backups/restoreDrills/errors'
import { NOT_FOUND, requireRestoreDrillAccess } from '@/lib/backups/restoreDrills/guard'
import { isDrillId } from '@/lib/backups/restoreDrills/request'
import { runScheduleAction } from '@/lib/backups/restoreDrills/scheduleActions'
import { scheduleAuditDetails } from '@/lib/backups/restoreDrills/schedules'
import { drillTargetDenied, prepareScheduleInput } from '@/lib/backups/restoreDrills/server'
import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW)
    if (denied) return denied

    const { id } = await ctx.params
    if (!isDrillId(id)) return NOT_FOUND()

    const res = await getOrchestratorClient().getRestoreDrillSchedule(id)

    return NextResponse.json({
      schedule: res.data?.schedule,
      runs: Array.isArray(res.data?.runs) ? res.data.runs : [],
      events: Array.isArray(res.data?.events) ? res.data.events : [],
    })
  } catch (e) {
    return drillErrorResponse(e, 'Failed to load the restore drill schedule')
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied

    const { id } = await ctx.params
    if (!isDrillId(id)) return NOT_FOUND()

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // The rights on the schedule as it stands, then on what it becomes: a
    // user cannot take over a schedule aimed at a node or a PBS they cannot
    // act on by moving it elsewhere.
    const client = getOrchestratorClient()
    const current = (await client.getRestoreDrillSchedule(id)).data?.schedule
    if (!current) return NOT_FOUND()
    const deniedNow = await drillTargetDenied(current.connection_id, current.node, current.source?.pbs_id ?? '')
    if (deniedNow) return deniedNow

    const prepared = await prepareScheduleInput(raw, access.userEmail)
    if (prepared.response) return prepared.response

    const res = await client.updateRestoreDrillSchedule(id, prepared.input)

    const { audit } = await import('@/lib/audit')
    await audit({
      action: 'update',
      category: 'backups',
      resourceType: 'restore_drill_schedule',
      resourceId: id,
      resourceName: prepared.input.name,
      details: scheduleAuditDetails(prepared.input),
    })

    return NextResponse.json(res.data)
  } catch (e) {
    return drillErrorResponse(e, 'Failed to update the restore drill schedule')
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return runScheduleAction(id, 'delete')
}
