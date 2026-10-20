// POST /api/v1/backups/restore-drills/{id}/cleanup    retry a failed cleanup

import { runDrillAction } from '@/lib/backups/restoreDrills/actions'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runDrillAction(id, 'cleanup')
}

export const POST = withAudit({ category: 'backups', resourceType: 'restore_drill', resourceParam: 'id', action: 'delete' }, handlePost)
