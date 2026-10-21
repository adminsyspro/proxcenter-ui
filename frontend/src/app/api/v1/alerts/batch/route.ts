import { NextResponse } from 'next/server'

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withAudit } from '@/lib/audit/withAudit'

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

    const body = await req.json()
    const { ids } = body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 })
    }

    const result = await prisma.alert.deleteMany({
      where: { id: { in: ids } }
    })

    return NextResponse.json({
      data: {
        deleted: result.count,
        message: `${result.count} alert(s) deleted`
      }
    })
  } catch (error: any) {
    console.error('[alerts/batch] DELETE error:', error)
    
return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

export const DELETE = withAudit({ category: 'alerts', resourceType: 'batch' }, handleDelete)
