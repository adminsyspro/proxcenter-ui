import { NextResponse } from 'next/server'

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withAudit } from '@/lib/audit/withAudit'
import { LOCAL_ALERT_ENTITY_SELECT, visibleLocalAlertIds } from '@/lib/alerts/localAlertScope'
import { deleteAlertsBatchSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

/**
 * DELETE /api/v1/alerts/batch
 * Supprimer des alertes par IDs
 */
async function handleDelete(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const permError = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (permError) return permError

    // Strings only, at most 500, and only the rows the caller sees (roadmap#223).
    const parsed = deleteAlertsBatchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 })
    }

    const ids = await visibleLocalAlertIds(parsed.data.ids, PERMISSIONS.ALERTS_MANAGE,
      list => prisma.alert.findMany({ where: { id: { in: list } }, select: LOCAL_ALERT_ENTITY_SELECT }))
    const deleted = ids.length === 0 ? 0 : (await prisma.alert.deleteMany({ where: { id: { in: ids } } })).count

    return NextResponse.json({
      data: {
        deleted,
        message: `${deleted} alert(s) deleted`
      }
    })
  } catch (error: any) {
    console.error('[alerts/batch] DELETE error:', error)
    
return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

export const DELETE = withAudit({ category: 'alerts', resourceType: 'batch' }, handleDelete)
