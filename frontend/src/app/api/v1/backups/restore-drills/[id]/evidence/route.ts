// GET /api/v1/backups/restore-drills/{id}/evidence    evidence of the drill, one PDF file

import { cookies } from 'next/headers'

import { drillErrorResponse } from '@/lib/backups/restoreDrills/errors'
import { renderDrillEvidencePdf } from '@/lib/backups/restoreDrills/evidence'
import { NOT_FOUND, requireRestoreDrillAccess } from '@/lib/backups/restoreDrills/guard'
import { isDrillId } from '@/lib/backups/restoreDrills/request'
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

    const locale = (await cookies()).get('NEXT_LOCALE')?.value
    return await renderDrillEvidencePdf(id, locale)
  } catch (e) {
    return drillErrorResponse(e, 'Failed to export the restore drill evidence')
  }
}
