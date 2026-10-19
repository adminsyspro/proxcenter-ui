// POST /api/v1/backups/restore-drills/{id}/cleanup    retry a failed cleanup

import { runDrillAction } from '@/lib/backups/restoreDrills/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runDrillAction(id, 'cleanup')
}
