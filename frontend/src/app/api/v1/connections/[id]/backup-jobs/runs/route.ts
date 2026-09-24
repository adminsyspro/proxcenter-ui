import { NextResponse } from 'next/server'

import { buildBackupRunsResult, clampDays, loadBackupRunsRaw } from '@/lib/backups/vzdumpRunsService'
import { filterBackupRunsForTenant, loadPoolByVmid } from '@/lib/backups/vzdumpRunsTenant'
import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { getAllowedJobPools } from '@/lib/vdc/backupJobs'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/v1/connections/[id]/backup-jobs/runs?days=30&noCache=1
 *
 * Run history of every PVE backup job of the connection, plus the "manual"
 * row of vzdump runs no job accounts for (issue #1003). Read live from the
 * node task indexes; see lib/backups/vzdumpRunsService.ts. The UI never sends
 * noCache (the server cache already lives 5 s while a task runs); it is
 * honoured for the provider and MSP only, never for a vDC tenant.
 */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: 'Missing connection ID' }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_VIEW, 'connection', id)
    if (denied) return denied

    const url = new URL(req.url)
    const days = clampDays(url.searchParams.get('days'))

    const conn = await getConnectionById(id)
    const allowedPools = await getAllowedJobPools(await getCurrentTenantId(), id)
    const noCache = allowedPools === null && url.searchParams.get('noCache') === '1'
    const raw = await loadBackupRunsRaw(conn, id, { days, noCache })

    if (allowedPools === null) return NextResponse.json({ data: buildBackupRunsResult(raw) })

    return NextResponse.json({ data: filterBackupRunsForTenant(raw, allowedPools, await loadPoolByVmid(conn)) })
  } catch (e: any) {
    console.error('[backup-jobs/runs] GET Error:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
