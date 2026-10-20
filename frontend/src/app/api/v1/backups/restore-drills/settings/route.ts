// GET /api/v1/backups/restore-drills/settings
// PUT /api/v1/backups/restore-drills/settings
//
// The single settings row of the drill engine: concurrency, disk budget, free
// space margin, default timeouts and network isolation.

import { NextResponse } from 'next/server'

import { drillErrorResponse } from '@/lib/backups/restoreDrills/errors'
import { requireRestoreDrillAccess } from '@/lib/backups/restoreDrills/guard'
import { parseDrillSettings } from '@/lib/backups/restoreDrills/request'
import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW)
    if (denied) return denied

    const res = await getOrchestratorClient().getRestoreDrillSettings()

    return NextResponse.json(res.data)
  } catch (e) {
    return drillErrorResponse(e, 'Failed to load the restore drill settings')
  }
}

async function handlePut(request: Request) {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied

    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = parseDrillSettings(body)
    if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const res = await getOrchestratorClient().updateRestoreDrillSettings(parsed.value)

    const { audit } = await import('@/lib/audit')
    await audit({
      action: 'update',
      category: 'backups',
      resourceType: 'restore_drill_settings',
      details: { ...parsed.value },
    })

    return NextResponse.json(res.data)
  } catch (e) {
    return drillErrorResponse(e, 'Failed to save the restore drill settings')
  }
}

export const PUT = withAudit({ category: 'backups', resourceType: 'setting' }, handlePut)
