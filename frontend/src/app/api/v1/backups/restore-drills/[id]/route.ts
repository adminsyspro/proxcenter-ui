// GET /api/v1/backups/restore-drills/{id}    one drill and its events

import { NextResponse } from 'next/server'

import { drillErrorResponse } from '@/lib/backups/restoreDrills/errors'
import { NOT_FOUND, requireRestoreDrillAccess } from '@/lib/backups/restoreDrills/guard'
import { isDrillId } from '@/lib/backups/restoreDrills/request'
import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW)
    if (denied) return denied

    const { id } = await ctx.params
    if (!isDrillId(id)) return NOT_FOUND()

    const res = await getOrchestratorClient().getRestoreDrill(id)

    return NextResponse.json({ drill: res.data?.drill, events: Array.isArray(res.data?.events) ? res.data.events : [] })
  } catch (e) {
    return drillErrorResponse(e, 'Failed to load the restore drill')
  }
}
