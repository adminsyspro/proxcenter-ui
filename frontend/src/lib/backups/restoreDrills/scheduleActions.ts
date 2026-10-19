// src/lib/backups/restoreDrills/scheduleActions.ts
//
// Delete and "run now" of a drill schedule. Both act for the schedule's
// target, so they need the same rights as creating it (VM_BACKUP and
// BACKUP_RESTORE on its node, BACKUP_VIEW on its PBS), judged on the stored
// schedule, never on the request.

import { NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

import { drillErrorResponse } from './errors'
import { NOT_FOUND, requireRestoreDrillAccess } from './guard'
import { isDrillId } from './request'
import { drillTargetDenied } from './server'

export type ScheduleAction = 'delete' | 'run'

export async function runScheduleAction(id: string, action: ScheduleAction): Promise<Response> {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied
    if (!isDrillId(id)) return NOT_FOUND()

    const client = getOrchestratorClient()
    const current = (await client.getRestoreDrillSchedule(id)).data?.schedule
    if (!current) return NOT_FOUND()

    const denied = await drillTargetDenied(current.connection_id, current.node, current.source?.pbs_id ?? '')
    if (denied) return denied

    const details = { connectionId: current.connection_id, node: current.node, pbsId: current.source?.pbs_id, calendar: current.calendar }
    const { audit } = await import('@/lib/audit')

    if (action === 'delete') {
      await client.deleteRestoreDrillSchedule(id)
      await audit({
        action: 'delete',
        category: 'backups',
        resourceType: 'restore_drill_schedule',
        resourceId: id,
        resourceName: current.name,
        details,
      })
      return new NextResponse(null, { status: 204 })
    }

    const res = await client.runRestoreDrillSchedule(id)
    await audit({
      action: 'test',
      category: 'backups',
      resourceType: 'restore_drill_schedule',
      resourceId: id,
      resourceName: current.name,
      details: { ...details, operation: 'run', runId: res.data?.run?.id },
    })
    return NextResponse.json(res.data, { status: 202 })
  } catch (e) {
    return drillErrorResponse(e, action === 'delete' ? 'Failed to delete the restore drill schedule' : 'Failed to run the restore drill schedule')
  }
}
