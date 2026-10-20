// POST /api/v1/backups/restore-drills/schedules/{id}/run    a pass now, same rules as a due pass

import { runScheduleAction } from '@/lib/backups/restoreDrills/scheduleActions'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runScheduleAction(id, 'run')
}

export const POST = withAudit({ category: 'backups', resourceType: 'schedule', resourceParam: 'id', action: 'run' }, handlePost)
