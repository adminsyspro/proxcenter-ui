// src/lib/backups/restoreDrills/actions.ts
//
// Cancel and cleanup of a drill. Both act on the temporary guest of the
// drill's target node, so the right is judged on that node, read from the
// drill itself (never from the request).

import { NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS, buildNodeResourceId, checkPermission } from '@/lib/rbac'

import { drillErrorResponse } from './errors'
import { NOT_FOUND, requireRestoreDrillAccess } from './guard'
import { isDrillId } from './request'

export type DrillAction = 'cancel' | 'cleanup'

export async function runDrillAction(id: string, action: DrillAction): Promise<Response> {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied
    if (!isDrillId(id)) return NOT_FOUND()

    const client = getOrchestratorClient()
    const current = (await client.getRestoreDrill(id)).data?.drill
    if (!current) return NOT_FOUND()

    const denied = await checkPermission(
      PERMISSIONS.BACKUP_RESTORE,
      'node',
      buildNodeResourceId(current.connection_id, current.node),
    )
    if (denied) return denied

    const res = action === 'cancel' ? await client.cancelRestoreDrill(id) : await client.cleanupRestoreDrill(id)

    const { audit } = await import('@/lib/audit')
    await audit({
      action: action === 'cancel' ? 'stop' : 'delete',
      category: 'backups',
      resourceType: 'restore_drill',
      resourceId: id,
      resourceName: current.source?.vm_name || current.temp_name || undefined,
      details: {
        operation: action,
        connectionId: current.connection_id,
        node: current.node,
        tempVmid: current.temp_vmid,
        tempName: current.temp_name,
      },
    })

    return NextResponse.json(res.data, { status: 202 })
  } catch (e) {
    return drillErrorResponse(e, action === 'cancel' ? 'Failed to cancel the restore drill' : 'Failed to clean up the restore drill')
  }
}
