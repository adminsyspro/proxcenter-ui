// GET  /api/v1/backups/restore-drills          one page of drills, active first, then newest
// POST /api/v1/backups/restore-drills          start a drill (roadmap#35)
//
// Provider only, licence `backup_restore_drills`. The orchestrator runs the
// drill; this route authorises it and resolves the PBS archive volid.

import { NextResponse } from 'next/server'

import { drillErrorResponse } from '@/lib/backups/restoreDrills/errors'
import { requireRestoreDrillAccess } from '@/lib/backups/restoreDrills/guard'
import { isDrillId, parseLimit, parseOffset } from '@/lib/backups/restoreDrills/request'
import { prepareDrillRequest } from '@/lib/backups/restoreDrills/server'
import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW)
    if (denied) return denied

    const params = new URL(request.url).searchParams
    // The drills of one schedule; a malformed id never reaches the orchestrator URL.
    const scheduleId = params.get('schedule_id') || ''
    const filter = isDrillId(scheduleId) ? scheduleId : ''
    const res = await getOrchestratorClient().listRestoreDrills(parseLimit(params.get('limit')), parseOffset(params.get('offset')), filter)
    const data = Array.isArray(res.data?.data) ? res.data.data : []
    const total = Number.isInteger(res.data?.total) ? res.data.total : data.length

    return NextResponse.json({ data, total })
  } catch (e) {
    return drillErrorResponse(e, 'Failed to list restore drills')
  }
}

async function handlePost(request: Request) {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const prepared = await prepareDrillRequest(body, access.userEmail)
    if (prepared.response) return prepared.response

    const res = await getOrchestratorClient().createRestoreDrill(prepared.request)
    const drill = res.data?.drill

    const { audit } = await import('@/lib/audit')
    await audit({
      action: 'test',
      category: 'backups',
      resourceType: 'restore_drill',
      resourceId: drill?.id,
      resourceName: prepared.input.vmName || `vm/${prepared.input.backupId}`,
      details: {
        connectionId: prepared.request.connection_id,
        node: prepared.request.node,
        targetStorage: prepared.request.target_storage,
        archive: prepared.request.archive,
        networkMode: prepared.request.network_mode,
        ...(prepared.request.bridge ? { bridge: prepared.request.bridge } : {}),
        pbsId: prepared.input.pbsId,
      },
    })

    return NextResponse.json(res.data, { status: 202 })
  } catch (e) {
    return drillErrorResponse(e, 'Failed to start the restore drill')
  }
}

export const POST = withAudit({ category: 'backups', resourceType: 'restore_drill' }, handlePost)
