// GET /api/v1/backups/restore-drills/{id}/screenshot    console screenshot of the test VM, PNG

import { drillErrorResponse } from '@/lib/backups/restoreDrills/errors'
import { NOT_FOUND, requireRestoreDrillAccess } from '@/lib/backups/restoreDrills/guard'
import { isDrillId } from '@/lib/backups/restoreDrills/request'
import { proxyDrillScreenshot } from '@/lib/backups/restoreDrills/screenshot'
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

    return await proxyDrillScreenshot(id)
  } catch (e) {
    return drillErrorResponse(e, 'Failed to read the restore drill screenshot')
  }
}
