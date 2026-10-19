// GET  /api/v1/backups/restore-drills/schedules     one page of drill schedules, enabled first, then by name
// POST /api/v1/backups/restore-drills/schedules     create a schedule (roadmap#35, addendum 4)
//
// Provider only, licence `backup_restore_drills`. The orchestrator runs the
// passes; this route authorises the schedule, resolves the PBS storage of
// the target cluster and stamps its author.

import { NextResponse } from 'next/server'

import { drillErrorResponse } from '@/lib/backups/restoreDrills/errors'
import { requireRestoreDrillAccess } from '@/lib/backups/restoreDrills/guard'
import { parseLimit, parseOffset } from '@/lib/backups/restoreDrills/request'
import { scheduleAuditDetails } from '@/lib/backups/restoreDrills/schedules'
import { prepareScheduleInput } from '@/lib/backups/restoreDrills/server'
import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW)
    if (denied) return denied

    const params = new URL(request.url).searchParams
    const res = await getOrchestratorClient().listRestoreDrillSchedules(parseLimit(params.get('limit')), parseOffset(params.get('offset')))
    const data = Array.isArray(res.data?.data) ? res.data.data : []
    const total = Number.isInteger(res.data?.total) ? res.data.total : data.length

    return NextResponse.json({ data, total })
  } catch (e) {
    return drillErrorResponse(e, 'Failed to list the restore drill schedules')
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const prepared = await prepareScheduleInput(raw, access.userEmail)
    if (prepared.response) return prepared.response

    const res = await getOrchestratorClient().createRestoreDrillSchedule(prepared.input)
    const schedule = res.data?.schedule

    const { audit } = await import('@/lib/audit')
    await audit({
      action: 'create',
      category: 'backups',
      resourceType: 'restore_drill_schedule',
      resourceId: schedule?.id,
      resourceName: prepared.input.name,
      details: scheduleAuditDetails(prepared.input),
    })

    return NextResponse.json(res.data, { status: 201 })
  } catch (e) {
    return drillErrorResponse(e, 'Failed to create the restore drill schedule')
  }
}
