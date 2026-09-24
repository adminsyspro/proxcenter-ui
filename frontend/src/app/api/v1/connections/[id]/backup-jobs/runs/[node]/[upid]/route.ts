import { NextResponse } from 'next/server'

import { collectBackupRuns, MAX_DAYS, loadRunTaskDetail } from '@/lib/backups/vzdumpRunsService'
import { filterBackupRunsForTenant, isTaskVisible, loadPoolByVmid } from '@/lib/backups/vzdumpRunsTenant'
import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { getAllowedJobPools } from '@/lib/vdc/backupJobs'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ id: string; node: string; upid: string }>
}

/**
 * GET /api/v1/connections/[id]/backup-jobs/runs/[node]/[upid]
 *
 * One vzdump task of a backup run: status and log split per guest (#1003).
 * Unlike the generic task route (CONNECTION_VIEW only), a vDC tenant only gets
 * a task that belongs to a run it can see, otherwise 404.
 */
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id, node, upid } = await ctx.params
    const decodedUpid = decodeURIComponent(upid)
    const parts = decodedUpid.split(':')
    if (parts[0] !== 'UPID' || parts[1] !== node || parts[5] !== 'vzdump') {
      return NextResponse.json({ error: 'Not a vzdump task of this node' }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_VIEW, 'connection', id)
    if (denied) return denied

    const conn = await getConnectionById(id)
    const allowedPools = await getAllowedJobPools(await getCurrentTenantId(), id)

    if (allowedPools !== null) {
      // The widest window the list route serves, so every run a tenant can see is found.
      const all = await collectBackupRuns(conn, id, { days: MAX_DAYS })
      const visible = filterBackupRunsForTenant(all, allowedPools, await loadPoolByVmid(conn))
      if (!isTaskVisible(visible, node, decodedUpid)) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }
    }

    return NextResponse.json({ data: await loadRunTaskDetail(conn, node, decodedUpid) })
  } catch (e: any) {
    console.error('[backup-jobs/runs/task] GET Error:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
