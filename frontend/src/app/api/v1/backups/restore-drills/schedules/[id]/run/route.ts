// POST /api/v1/backups/restore-drills/schedules/{id}/run    a pass now, same rules as a due pass

import { runScheduleAction } from '@/lib/backups/restoreDrills/scheduleActions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runScheduleAction(id, 'run')
}
